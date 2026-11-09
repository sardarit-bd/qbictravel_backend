import { prisma } from "../../lib/prisma.js";
import AppError from "../../shared/utils/AppError.js";
import type { PaymentFilters, PaymentMethodValue, PaymentRecordStatusValue } from "./paymentTypes.js";
import { createCommissionForBooking } from "../commission/commissionRepository.js";
import { enqueueOutboxMessage } from "../outbox/outboxService.js";
import type { OutboxTopic } from "../../../generated/prisma/enums.js";

type PrismaTx = any;
type HistoryChanges = Record<string, string | number | boolean | null>;

// Statuses that represent an in-progress or completed payment attempt
const ACTIVE_STATUSES: PaymentRecordStatusValue[] = [
  "INITIATED",
  "SUBMITTED",
  "PROCESSING",
  "REQUIRES_ACTION",
  "VERIFIED",
];

const PAYABLE_BOOKING_STATUSES: ("PENDING" | "CONFIRMED")[] = ["PENDING", "CONFIRMED"];

const paymentInclude = {
  booking: {
    select: {
      id: true,
      serviceId: true,
      agentId: true,
      status: true,
      paymentStatus: true,
      requiresApproval: true,
      currency: true,
      finalPrice: true,
      service: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
} as const;

export const findBookingForPayment = async (bookingId: string) => {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      customerId: true,
      agentId: true,
      status: true,
      requiresApproval: true,
      paymentStatus: true,
      currency: true,
      finalPrice: true,
      customer: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      service: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
};

export const createPaymentIfNoneActive = async (params: {
  bookingId: string;
  customerId: string;
  amount: number;
  currency: string;
  method: PaymentMethodValue;
  status: "INITIATED" | "SUBMITTED";
  reference?: string;
  receiptNote?: string;
}) => {
  return prisma.$transaction(
    async (tx) => {
      const active = await tx.payment.count({
        where: { bookingId: params.bookingId, status: { in: ACTIVE_STATUSES } },
      });

      if (active > 0) {
        return null;
      }

      const payment = await tx.payment.create({
        data: {
          bookingId: params.bookingId,
          customerId: params.customerId,
          amount: params.amount,
          currency: params.currency,
          method: params.method,
          status: params.status,
          reference: params.reference ?? null,
          receiptNote: params.receiptNote ?? null,
          submittedAt: params.status === "SUBMITTED" ? new Date() : null,
        },
      });

      await tx.bookingHistory.create({
        data: {
          bookingId: params.bookingId,
          actorId: params.customerId,
          actorRole: "customer",
          action: params.status === "SUBMITTED" ? "PAYMENT_SUBMITTED" : "PAYMENT_INITIATED",
          changes: {
            paymentId: payment.id,
            amount: params.amount,
            currency: params.currency,
            method: params.method,
            reference: params.reference ?? null,
          },
        },
      });

      return payment;
    },
    { isolationLevel: "Serializable" },
  );
};

export const findPaymentById = async (paymentId: string) => {
  return prisma.payment.findUnique({
    where: { id: paymentId },
    include: paymentInclude,
  });
};

export const findPaymentByStripeSessionId = async (stripeSessionId: string) => {
  return prisma.payment.findFirst({
    where: { stripeSessionId },
    include: paymentInclude,
  });
};

export const findPaymentByStripePaymentIntentId = async (stripePaymentIntentId: string) => {
  return prisma.payment.findFirst({
    where: { stripePaymentIntentId },
    include: paymentInclude,
  });
};

export const findActiveStripePaymentForBooking = async (bookingId: string) => {
  return prisma.payment.findFirst({
    where: {
      bookingId,
      method: "STRIPE",
      status: { in: ["INITIATED", "PROCESSING", "REQUIRES_ACTION"] },
    },
    include: paymentInclude,
    orderBy: { createdAt: "desc" },
  });
};

export const findVerifiedPaymentForBooking = async (bookingId: string) => {
  return prisma.payment.findFirst({
    where: {
      bookingId,
      status: "VERIFIED",
    },
    include: paymentInclude,
  });
};

export const listPayments = async (filters: PaymentFilters, skip: number, take: number) => {
  const where = {
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.agentId ? { booking: { agentId: filters.agentId } } : {}),
    ...(filters.bookingId ? { bookingId: filters.bookingId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.method ? { method: filters.method } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: paymentInclude,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.payment.count({ where }),
  ]);

  return { items, total };
};

export const transitionPayment = async (params: {
  paymentId: string;
  bookingId: string;
  amount: number;
  fromStatus: "INITIATED" | "SUBMITTED";
  toStatus: "VERIFIED" | "REJECTED";
  adminId: string;
  notes?: string;
  reference?: string;
  receivedAt?: Date;
  action: string;
  changes: HistoryChanges;
}) => {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.payment.updateMany({
      where: { id: params.paymentId, status: params.fromStatus },
      data: {
        status: params.toStatus,
        reviewedById: params.adminId,
        reviewedAt: new Date(),
        reviewNotes: params.notes ?? null,
        ...(params.reference ? { reference: params.reference } : {}),
        ...(params.receivedAt ? { receivedAt: params.receivedAt } : {}),
      },
    });

    if (updated.count === 0) {
      return null;
    }

    if (params.toStatus === "VERIFIED") {
      // Find current booking state to verify eligibility for confirmation
      const targetBooking = await tx.booking.findUnique({
        where: { id: params.bookingId },
        select: { id: true, status: true, paymentStatus: true, requiresApproval: true, finalPrice: true },
      });

      if (!targetBooking) {
        throw new AppError("Booking not found", 404);
      }

      if (
        targetBooking.paymentStatus !== "UNPAID" ||
        targetBooking.requiresApproval ||
        !PAYABLE_BOOKING_STATUSES.includes(targetBooking.status as any) ||
        Number(targetBooking.finalPrice) !== params.amount
      ) {
        throw new AppError("The booking can no longer accept this payment", 409);
      }

      // Check if booking is eligible for automatic confirmation:
      // Eligible when status is PENDING and not requiring price approval
      const shouldAutoConfirm = targetBooking.status === "PENDING" && !targetBooking.requiresApproval;

      const booking = await tx.booking.updateMany({
        where: {
          id: params.bookingId,
          paymentStatus: "UNPAID",
          requiresApproval: false,
          status: { in: PAYABLE_BOOKING_STATUSES },
          finalPrice: params.amount,
        },
        data: {
          paymentStatus: "PAID",
          ...(shouldAutoConfirm ? { status: "CONFIRMED" } : {}),
        },
      });

      if (booking.count === 0) {
        throw new AppError("The booking can no longer accept this payment", 409);
      }

      if (shouldAutoConfirm) {
        await tx.bookingHistory.create({
          data: {
            bookingId: params.bookingId,
            actorId: params.adminId,
            actorRole: "admin",
            action: "BOOKING_AUTO_CONFIRMED",
            changes: {
              fromStatus: "PENDING",
              toStatus: "CONFIRMED",
              trigger: "PAYMENT_VERIFIED",
              paymentId: params.paymentId,
            },
          },
        });
      }

      await createCommissionForBooking(tx, params.bookingId);
    }

    await tx.bookingHistory.create({
      data: {
        bookingId: params.bookingId,
        actorId: params.adminId,
        actorRole: "admin",
        action: params.action,
        changes: params.changes,
      },
    });

    return tx.payment.findUniqueOrThrow({
      where: { id: params.paymentId },
      include: paymentInclude,
    });
  });
};

/**
 * Creates or reuses a Stripe payment record for a booking with serializable conflict protection.
 */
export const createOrGetStripePayment = async (params: {
  bookingId: string;
  customerId: string;
  amount: number;
  currency: string;
}) => {
  return prisma.$transaction(
    async (tx) => {
      // Check for any already verified payment
      const verified = await tx.payment.findFirst({
        where: { bookingId: params.bookingId, status: "VERIFIED" },
        include: paymentInclude,
      });
      if (verified) {
        return { payment: verified, isAlreadyVerified: true, isExistingActive: false };
      }

      // Check for existing active STRIPE payment attempt
      const activeStripe = await tx.payment.findFirst({
        where: {
          bookingId: params.bookingId,
          method: "STRIPE",
          status: { in: ["INITIATED", "PROCESSING", "REQUIRES_ACTION"] },
        },
        include: paymentInclude,
        orderBy: { createdAt: "desc" },
      });

      if (activeStripe) {
        return { payment: activeStripe, isAlreadyVerified: false, isExistingActive: true };
      }

      // Check if there is another active payment of another method (e.g. SUBMITTED bank transfer)
      const otherActive = await tx.payment.count({
        where: {
          bookingId: params.bookingId,
          method: { not: "STRIPE" },
          status: { in: ["INITIATED", "SUBMITTED"] },
        },
      });

      if (otherActive > 0) {
        throw new AppError(
          "This booking has an active manual payment awaiting verification. Cancel or resolve it first.",
          409,
        );
      }

      // Create new INITIATED Stripe payment
      const payment = await tx.payment.create({
        data: {
          bookingId: params.bookingId,
          customerId: params.customerId,
          amount: params.amount,
          currency: params.currency,
          method: "STRIPE",
          status: "INITIATED",
        },
        include: paymentInclude,
      });

      await tx.bookingHistory.create({
        data: {
          bookingId: params.bookingId,
          actorId: params.customerId,
          actorRole: "customer",
          action: "STRIPE_PAYMENT_INITIATED",
          changes: {
            paymentId: payment.id,
            amount: params.amount,
            currency: params.currency,
          },
        },
      });

      return { payment, isAlreadyVerified: false, isExistingActive: false };
    },
    { isolationLevel: "Serializable" },
  );
};

/**
 * Updates a Stripe payment record with session and payment intent IDs.
 */
export const updatePaymentStripeSession = async (
  paymentId: string,
  stripeSessionId: string,
  stripePaymentIntentId?: string | null,
) => {
  return prisma.payment.update({
    where: { id: paymentId },
    data: {
      stripeSessionId,
      ...(stripePaymentIntentId ? { stripePaymentIntentId } : {}),
      reference: stripePaymentIntentId || stripeSessionId,
    },
  });
};

/**
 * Records an incoming Stripe Webhook event in the database for idempotency.
 * Returns { event, isDuplicate }
 */
export const recordWebhookEventReceived = async (params: {
  eventId: string;
  type: string;
  payload: any;
  bookingId?: string;
  paymentId?: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.stripeWebhookEvent.findUnique({
      where: { id: params.eventId },
    });

    if (existing) {
      return { event: existing, isDuplicate: true };
    }

    const created = await tx.stripeWebhookEvent.create({
      data: {
        id: params.eventId,
        type: params.type,
        status: "RECEIVED",
        payload: params.payload,
        bookingId: params.bookingId ?? null,
        paymentId: params.paymentId ?? null,
      },
    });

    return { event: created, isDuplicate: false };
  });
};

/**
 * Marks a Stripe Webhook event as PROCESSING with a worker lock.
 */
export const lockWebhookEventForProcessing = async (eventId: string, workerId: string) => {
  return prisma.$transaction(async (tx) => {
    const event = await tx.stripeWebhookEvent.findUnique({ where: { id: eventId } });
    if (!event) return null;

    if (event.status === "PROCESSED" || event.status === "IGNORED") {
      return null; // Already final
    }

    // If locked recently (within 2 minutes), do not steal lock
    if (event.lockedAt && Date.now() - event.lockedAt.getTime() < 120_000 && event.lockedBy !== workerId) {
      return null;
    }

    return tx.stripeWebhookEvent.update({
      where: { id: eventId },
      data: {
        status: "PROCESSING",
        lockedAt: new Date(),
        lockedBy: workerId,
        attempts: { increment: 1 },
      },
    });
  });
};

/**
 * Marks a webhook event as PROCESSED or IGNORED.
 */
export const completeWebhookEvent = async (
  eventId: string,
  status: "PROCESSED" | "IGNORED",
  bookingId?: string,
  paymentId?: string,
) => {
  return prisma.stripeWebhookEvent.update({
    where: { id: eventId },
    data: {
      status,
      processedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      ...(bookingId ? { bookingId } : {}),
      ...(paymentId ? { paymentId } : {}),
    },
  });
};

/**
 * Marks a webhook event as FAILED with last error.
 */
export const failWebhookEvent = async (eventId: string, errorMessage: string) => {
  return prisma.stripeWebhookEvent.update({
    where: { id: eventId },
    data: {
      status: "FAILED",
      lastError: errorMessage,
      lockedAt: null,
      lockedBy: null,
    },
  });
};

/**
 * Transition payment upon successful Stripe payment verification.
 * Enforces:
 * - Idempotency: if already VERIFIED, returns immediately without creating duplicate commissions or outbox messages.
 * - Outbox: enqueues CALCULATE_COMMISSION and SEND_BOOKING_VOUCHER_EMAIL inside the same transaction.
 * - Never downgrades a VERIFIED payment.
 */
export const verifyStripePaymentAtomically = async (params: {
  paymentId: string;
  bookingId: string;
  amount: number;
  currency: string;
  stripePaymentIntentId?: string;
  stripeSessionId?: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: params.paymentId },
      include: paymentInclude,
    });

    if (!payment) {
      throw new AppError("Payment record not found", 404);
    }

    // Idempotency check: Already verified
    if (payment.status === "VERIFIED") {
      return { payment, isDuplicateSuccess: true };
    }

    // Check if another payment for this booking is already VERIFIED
    const alreadyVerifiedOther = await tx.payment.findFirst({
      where: {
        bookingId: params.bookingId,
        id: { not: params.paymentId },
        status: "VERIFIED",
      },
    });

    if (alreadyVerifiedOther) {
      // Multiple successful payments detected for the same booking!
      // Financial Safety requirement: Never overwrite or discard, mark with alert changes and do not automatically refund.
      await tx.payment.update({
        where: { id: params.paymentId },
        data: {
          status: "REQUIRES_ACTION",
          failureReason: `DUPLICATE_PAYMENT_DETECTED: Booking already verified by payment ${alreadyVerifiedOther.id}`,
          reference: params.stripePaymentIntentId || params.stripeSessionId || payment.reference,
          receivedAt: new Date(),
        },
      });

      await tx.bookingHistory.create({
        data: {
          bookingId: params.bookingId,
          actorId: payment.customerId,
          actorRole: "customer",
          action: "DUPLICATE_STRIPE_PAYMENT_DETECTED",
          changes: {
            duplicatePaymentId: payment.id,
            verifiedPaymentId: alreadyVerifiedOther.id,
            amount: params.amount,
            currency: params.currency,
          },
        },
      });

      await enqueueOutboxMessage(tx, {
        topic: "SEND_ADMIN_PAYMENT_ALERT",
        payload: {
          bookingId: params.bookingId,
          duplicatePaymentId: payment.id,
          verifiedPaymentId: alreadyVerifiedOther.id,
          amount: params.amount,
          currency: params.currency,
          reason: "Duplicate successful charge detected on Stripe",
        },
      });

      return {
        payment: await tx.payment.findUniqueOrThrow({
          where: { id: params.paymentId },
          include: paymentInclude,
        }),
        isDuplicateSuccess: false,
        isOverpayment: true,
      };
    }

    // Verify booking finalPrice & currency match
    const booking = payment.booking;
    if (Number(booking.finalPrice) !== params.amount) {
      throw new AppError(
        `Amount mismatch: Stripe received ${params.amount} but booking requires ${booking.finalPrice}`,
        400,
      );
    }
    if (booking.currency.toUpperCase() !== params.currency.toUpperCase()) {
      throw new AppError(
        `Currency mismatch: Stripe received ${params.currency} but booking is in ${booking.currency}`,
        400,
      );
    }

    // Update payment to VERIFIED
    const updatedPayment = await tx.payment.update({
      where: { id: params.paymentId },
      data: {
        status: "VERIFIED",
        receivedAt: new Date(),
        reference: params.stripePaymentIntentId || params.stripeSessionId || payment.reference,
        stripePaymentIntentId: params.stripePaymentIntentId ?? payment.stripePaymentIntentId,
        stripeSessionId: params.stripeSessionId ?? payment.stripeSessionId,
      },
      include: paymentInclude,
    });

    // Check if booking is eligible for automatic confirmation:
    // Eligible when:
    // 1. Current booking status is PENDING
    // 2. Booking does not require price approval (requiresApproval is false)
    // 3. Paid amount matches authoritative booking finalPrice (verified above)
    // 4. Currency matches authoritative booking currency (verified above)
    const shouldAutoConfirm = booking.status === "PENDING" && !booking.requiresApproval;

    // Update booking paymentStatus to PAID, and transition status to CONFIRMED if eligible
    await tx.booking.update({
      where: { id: params.bookingId },
      data: {
        paymentStatus: "PAID",
        ...(shouldAutoConfirm ? { status: "CONFIRMED" } : {}),
      },
    });

    // History record for payment verification
    await tx.bookingHistory.create({
      data: {
        bookingId: params.bookingId,
        actorId: payment.customerId,
        actorRole: "customer",
        action: "STRIPE_PAYMENT_VERIFIED",
        changes: {
          paymentId: payment.id,
          amount: params.amount,
          currency: params.currency,
          stripePaymentIntentId: params.stripePaymentIntentId ?? null,
          stripeSessionId: params.stripeSessionId ?? null,
          autoConfirmed: shouldAutoConfirm,
        },
      },
    });

    // If auto-confirmed, record status transition in booking history
    if (shouldAutoConfirm) {
      await tx.bookingHistory.create({
        data: {
          bookingId: params.bookingId,
          actorId: payment.customerId,
          actorRole: "customer",
          action: "BOOKING_AUTO_CONFIRMED",
          changes: {
            fromStatus: "PENDING",
            toStatus: "CONFIRMED",
            trigger: "STRIPE_PAYMENT_VERIFIED",
            paymentId: payment.id,
          },
        },
      });
    }

    // Transactional Outbox for asynchronous durability
    await enqueueOutboxMessage(tx, {
      topic: "CALCULATE_COMMISSION",
      payload: { bookingId: params.bookingId, paymentId: payment.id },
    });

    if (tx.commission && tx.commissionRule) {
      await createCommissionForBooking(tx, params.bookingId);
    }

    await enqueueOutboxMessage(tx, {
      topic: "SEND_BOOKING_VOUCHER_EMAIL",
      payload: { bookingId: params.bookingId, decision: "CONFIRMED" },
    });

    return { payment: updatedPayment, isDuplicateSuccess: false, isOverpayment: false };
  });
};

/**
 * Updates a Stripe payment status to FAILED or CANCELLED.
 * Financial safety: never downgrades a VERIFIED payment.
 */
export const updateStripePaymentStatus = async (params: {
  paymentId: string;
  bookingId: string;
  status: "FAILED" | "CANCELLED" | "PROCESSING" | "REQUIRES_ACTION";
  failureReason?: string;
  stripePaymentIntentId?: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: params.paymentId } });
    if (!payment) {
      return null;
    }

    // Safety rule: Never downgrade from VERIFIED
    if (payment.status === "VERIFIED") {
      return payment;
    }

    const updated = await tx.payment.update({
      where: { id: params.paymentId },
      data: {
        status: params.status,
        failureReason: params.failureReason ?? payment.failureReason,
        ...(params.stripePaymentIntentId ? { stripePaymentIntentId: params.stripePaymentIntentId } : {}),
      },
      include: paymentInclude,
    });

    await tx.bookingHistory.create({
      data: {
        bookingId: params.bookingId,
        actorId: payment.customerId,
        actorRole: "customer",
        action: `STRIPE_PAYMENT_${params.status}`,
        changes: {
          paymentId: payment.id,
          newStatus: params.status,
          failureReason: params.failureReason ?? null,
        },
      },
    });

    return updated;
  });
};
