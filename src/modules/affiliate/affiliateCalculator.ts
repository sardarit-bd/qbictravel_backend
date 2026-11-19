import crypto from "crypto";

/**
 * Convert a decimal currency amount (number or string) to integer minor units (cents/satang).
 * Avoids IEEE-754 floating point drift in all financial calculations.
 */
export function toCents(amount: number | string): number {
  const num = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid monetary amount: ${amount}`);
  }
  return Math.round(num * 100);
}

/**
 * Convert integer minor units back to a 2-decimal-place number.
 */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * Convert a percentage rate (e.g. 12.5%) to basis points (1250) for integer math.
 */
export function toBasisPoints(ratePercent: number | string): number {
  const num = typeof ratePercent === "string" ? Number(ratePercent) : ratePercent;
  if (!Number.isFinite(num) || num < 0 || num > 100) {
    throw new Error(`Invalid commission rate percentage: ${ratePercent}`);
  }
  return Math.round(num * 100);
}

/**
 * Resolve the effective commission rate: individual override takes precedence over global rate.
 */
export function resolveEffectiveRate(
  globalRate: number | string,
  individualOverride?: number | string | null
): number {
  if (individualOverride !== null && individualOverride !== undefined) {
    return Number(individualOverride);
  }
  return Number(globalRate);
}

/**
 * Calculate affiliate commission using integer-cent + basis-point arithmetic.
 * Formula: commission = eligible_paid_amount * applied_commission_rate / 100
 * Clamped to [0, eligibleAmount].
 */
export function calculateAffiliateCommission(
  eligibleAmount: number | string,
  ratePercent: number | string
): number {
  const eligibleCents = toCents(eligibleAmount);
  if (eligibleCents <= 0) return 0;

  const rateBps = toBasisPoints(ratePercent);
  if (rateBps <= 0) return 0;

  // eligibleCents * rateBps / 10000 (since 100% = 10000 bps)
  const commissionCents = Math.round((eligibleCents * rateBps) / 10000);
  const clampedCents = Math.max(0, Math.min(eligibleCents, commissionCents));
  return fromCents(clampedCents);
}

/**
 * Calculate the capped commission for a (possibly partial) payment so that
 * cumulative earned commissions across multiple payments never exceed
 * the maximum commission for the booking's eligible total.
 */
export function calculateCappedPaymentCommission(params: {
  paymentAmount: number | string;
  bookingEligibleTotal: number | string;
  alreadyCommissionedEligibleAmount: number | string;
  ratePercent: number | string;
}): { eligibleAmount: number; commissionAmount: number } {
  const paymentCents = Math.max(0, toCents(params.paymentAmount));
  const bookingTotalCents = Math.max(0, toCents(params.bookingEligibleTotal));
  const alreadyCents = Math.max(0, toCents(params.alreadyCommissionedEligibleAmount));

  const remainingEligibleCents = Math.max(0, bookingTotalCents - alreadyCents);
  const effectiveEligibleCents = Math.min(paymentCents, remainingEligibleCents);

  if (effectiveEligibleCents <= 0) {
    return { eligibleAmount: 0, commissionAmount: 0 };
  }

  const eligibleAmount = fromCents(effectiveEligibleCents);
  const commissionAmount = calculateAffiliateCommission(eligibleAmount, params.ratePercent);
  return { eligibleAmount, commissionAmount };
}

/**
 * Calculate a negative reversal amount for a full or partial refund,
 * using the original commission's snapshotted rate and capping at the remaining
 * unreversed earned commission for the booking.
 */
export function calculateRefundReversal(params: {
  refundAmount: number | string;
  originalRatePercent: number | string;
  netEarnedCommissionForBooking: number | string;
}): number {
  const refundCents = Math.max(0, toCents(params.refundAmount));
  const netEarnedCents = Math.max(0, toCents(params.netEarnedCommissionForBooking));
  if (refundCents <= 0 || netEarnedCents <= 0) return 0;

  const rawReversal = calculateAffiliateCommission(
    fromCents(refundCents),
    params.originalRatePercent
  );
  const reversalCents = Math.min(netEarnedCents, toCents(rawReversal));
  return reversalCents > 0 ? -fromCents(reversalCents) : 0;
}

/**
 * Calculate available, pending, earned, and paid balances from ledger + payout totals.
 * All arithmetic performed in integer cents.
 */
export function calculateAffiliateBalances(params: {
  availableLedgerSum: number | string;
  pendingLedgerSum: number | string;
  reservedPayoutsSum: number | string; // PENDING + APPROVED payouts
  paidPayoutsSum: number | string;     // PAID payouts
}): {
  totalEarned: number;
  pendingCommission: number;
  reservedForPayout: number;
  paidCommission: number;
  availableBalance: number;
} {
  const availableLedgerCents = toCents(params.availableLedgerSum);
  const pendingLedgerCents = toCents(params.pendingLedgerSum);
  const reservedCents = Math.max(0, toCents(params.reservedPayoutsSum));
  const paidCents = Math.max(0, toCents(params.paidPayoutsSum));

  const totalEarnedCents = Math.max(0, availableLedgerCents + pendingLedgerCents);
  const availableBalanceCents = Math.max(0, availableLedgerCents - reservedCents - paidCents);

  return {
    totalEarned: fromCents(totalEarnedCents),
    pendingCommission: fromCents(Math.max(0, pendingLedgerCents)),
    reservedForPayout: fromCents(reservedCents),
    paidCommission: fromCents(paidCents),
    availableBalance: fromCents(availableBalanceCents),
  };
}

/**
 * Generate a unique human-friendly affiliate referral code (e.g. AFF4K9M2X).
 */
export function generateAffiliateCode(prefix = "AFF"): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.randomBytes(6);
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += alphabet[bytes[i]! % alphabet.length];
  }
  return `${prefix}${suffix}`;
}
