import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import {
  calculateCappedPaymentCommission,
  calculateRefundReversal,
  resolveEffectiveRate,
} from "./affiliateCalculator.js";
import { affiliateNotification } from "./affiliateNotification.js";
import logger from "../../shared/logger/logger.js";

type DbClient = Prisma.TransactionClient | typeof prisma;

export async function getOrCreateAffiliateSettings(db: DbClient = prisma) {
  let settings = await db.affiliateSettings.findUnique({ where: { id: "default" } });
  if (!settings) {
    settings = await db.affiliateSettings.create({
      data: {
        id: "default",
        globalCommissionRate: 10.0,
        attributionWindowDays: 30,
        minimumPayoutAmount: 50.0,
        eligibleAmountPolicy: "NET_AFTER_DISCOUNTS",
        isProgramActive: true,
      },
    });
  }
  return settings;
}

/**
 * Generates an affiliate commission ledger entry for a VERIFIED customer payment.
 * - Idempotent on `payment:<paymentId>:earned` (safe for duplicate webhooks).
 * - Never generates commission for unattributed, self-referred, non-approved, or non-customer bookings.
 * - Caps cumulative commissioned eligible amount at booking.finalPrice (supports partial payments).
 * - Snapshots rate, eligible amount, currency, and commission amount permanently.
 */
export async function recordAffiliateCommissionForVerifiedPayment(
  tx: Prisma.TransactionClient,
  params: {
    paymentId: string;
    bookingId: string;
    paidAmount: number | string;
    currency: string;
  }
) {
  const idempotencyKey = `payment:${params.paymentId}:earned`;

  // Fast idempotency check
  const existing = await tx.affiliateCommission.findUnique({
    where: { idempotencyKey },
  });
  if (existing) {
    return { created: false, commission: existing };
  }

  const booking = await tx.booking.findUnique({
    where: { id: params.bookingId },
    include: {
      affiliateAttribution: {
        include: {
          affiliate: {
            include: { user: { select: { id: true, name: true, email: true, role: true } } },
          },
        },
      },
    },
  });

  if (!booking || !booking.affiliateAttribution) {
    return { created: false, commission: null };
  }

  // Only customer/direct bookings are eligible; never operational Agent/Admin/Staff bookings
  if (booking.agentId || booking.source === "AGENT" || booking.source === "ADMIN") {
    return { created: false, commission: null };
  }

  const { affiliate } = booking.affiliateAttribution;
  if (!affiliate || affiliate.status !== "APPROVED") {
    return { created: false, commission: null };
  }

  // Ineligible roles (Agent, Staff, Admin) can never generate affiliate commissions
  if (
    affiliate.user?.role === "agent" ||
    affiliate.user?.role === "staff" ||
    affiliate.user?.role === "admin"
  ) {
    return { created: false, commission: null };
  }

  // Self-referral safeguard
  if (affiliate.userId === booking.customerId) {
    return { created: false, commission: null };
  }

  const settings = await getOrCreateAffiliateSettings(tx);
  if (!settings.isProgramActive) {
    return { created: false, commission: null };
  }

  const effectiveRate = resolveEffectiveRate(
    settings.globalCommissionRate.toString(),
    affiliate.commissionRateOverride?.toString() ?? null
  );

  const bookingEligibleTotal =
    settings.eligibleAmountPolicy === "GROSS"
      ? booking.basePrice.toString()
      : booking.finalPrice.toString();

  // Sum already-commissioned eligible amount for this booking (supports partial payments)
  const priorEarned = await tx.affiliateCommission.aggregate({
    where: { bookingId: booking.id, entryType: "EARNED" },
    _sum: { eligibleAmount: true },
  });

  const { eligibleAmount, commissionAmount } = calculateCappedPaymentCommission({
    paymentAmount: params.paidAmount,
    bookingEligibleTotal,
    alreadyCommissionedEligibleAmount: priorEarned._sum.eligibleAmount?.toString() ?? "0",
    ratePercent: effectiveRate,
  });

  if (commissionAmount <= 0) {
    return { created: false, commission: null };
  }

  const commission = await tx.affiliateCommission.create({
    data: {
      affiliateId: affiliate.id,
      bookingId: booking.id,
      paymentId: params.paymentId,
      entryType: "EARNED",
      eligibleAmount,
      commissionRate: effectiveRate,
      amount: commissionAmount,
      currency: params.currency || booking.currency,
      status: "AVAILABLE",
      idempotencyKey,
      notes: `Commission (${effectiveRate}%) on verified payment ${params.paymentId}`,
    },
  });

  await tx.affiliateAuditEvent.create({
    data: {
      affiliateId: affiliate.id,
      entityType: "COMMISSION",
      entityId: commission.id,
      action: "COMMISSION_EARNED",
      metadata: {
        bookingId: booking.id,
        paymentId: params.paymentId,
        eligibleAmount,
        commissionRate: effectiveRate,
        amount: commissionAmount,
        currency: commission.currency,
      },
    },
  });

  // Fire-and-forget notification after creation (deduplicated because idempotencyKey prevents re-entry)
  if (affiliate.user?.email) {
    void affiliateNotification.notifyAffiliateCommissionEarned({
      email: affiliate.user.email,
      name: affiliate.user.name,
      bookingId: booking.id,
      amount: commissionAmount,
      currency: commission.currency,
      rate: effectiveRate,
    });
  }

  return { created: true, commission };
}

/**
 * Records a negative REVERSAL ledger entry for a full or partial refund / chargeback.
 * - Never deletes historical commission records.
 * - Idempotent on `refund:<refundId>:reversal`.
 */
export async function recordAffiliateCommissionReversal(
  tx: Prisma.TransactionClient,
  params: {
    bookingId: string;
    paymentId?: string | null;
    refundId: string;
    refundAmount: number | string;
    currency?: string;
    reason?: string;
    actorId?: string;
  }
) {
  const idempotencyKey = `refund:${params.refundId}:reversal`;
  const existing = await tx.affiliateCommission.findUnique({ where: { idempotencyKey } });
  if (existing) {
    return { created: false, reversal: existing };
  }

  const earnedEntries = await tx.affiliateCommission.findMany({
    where: { bookingId: params.bookingId },
    orderBy: { createdAt: "asc" },
  });

  const firstEarned = earnedEntries.find((e) => e.entryType === "EARNED");
  if (!firstEarned) {
    return { created: false, reversal: null };
  }

  const netEarned = earnedEntries.reduce((acc, e) => acc + Number(e.amount), 0);
  const reversalAmount = calculateRefundReversal({
    refundAmount: params.refundAmount,
    originalRatePercent: firstEarned.commissionRate.toString(),
    netEarnedCommissionForBooking: netEarned,
  });

  if (reversalAmount >= 0) {
    return { created: false, reversal: null };
  }

  const reversal = await tx.affiliateCommission.create({
    data: {
      affiliateId: firstEarned.affiliateId,
      bookingId: params.bookingId,
      paymentId: params.paymentId ?? firstEarned.paymentId,
      entryType: "REVERSAL",
      eligibleAmount: Number(params.refundAmount),
      commissionRate: Number(firstEarned.commissionRate),
      amount: reversalAmount,
      currency: params.currency ?? firstEarned.currency,
      status: "REVERSED",
      idempotencyKey,
      notes: params.reason ?? `Reversal for refund ${params.refundId}`,
      createdById: params.actorId ?? null,
    },
  });

  await tx.affiliateAuditEvent.create({
    data: {
      affiliateId: firstEarned.affiliateId,
      entityType: "COMMISSION",
      entityId: reversal.id,
      action: "COMMISSION_REVERSED",
      actorId: params.actorId ?? null,
      metadata: {
        bookingId: params.bookingId,
        paymentId: params.paymentId ?? null,
        refundId: params.refundId,
        refundAmount: Number(params.refundAmount),
        reversalAmount,
      },
    },
  });

  logger.info(
    { bookingId: params.bookingId, refundId: params.refundId, reversalAmount },
    "Recorded affiliate commission reversal"
  );

  return { created: true, reversal };
}
