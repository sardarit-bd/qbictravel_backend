import { describe, it, expect } from "vitest";
import {
  calculateAffiliateCommission,
  calculateCappedPaymentCommission,
  calculateRefundReversal,
  calculateAffiliateBalances,
  resolveEffectiveRate,
  generateAffiliateCode,
} from "../../affiliateCalculator.js";
import {
  signAttributionToken,
  verifyAttributionToken,
} from "../../affiliateAttribution.js";

describe("affiliateCalculator", () => {
  it("resolves individual override over global rate and falls back to global rate", () => {
    expect(resolveEffectiveRate(10, 15)).toBe(15);
    expect(resolveEffectiveRate("10.00", "12.50")).toBe(12.5);
    expect(resolveEffectiveRate(10, null)).toBe(10);
    expect(resolveEffectiveRate(10, undefined)).toBe(10);
    expect(resolveEffectiveRate(10, 0)).toBe(0);
  });

  it("calculates commission with exact integer-cent arithmetic (no float drift)", () => {
    expect(calculateAffiliateCommission(1000, 10)).toBe(100);
    expect(calculateAffiliateCommission("199.99", "12.5")).toBe(25);
    expect(calculateAffiliateCommission(333.33, 15)).toBe(50);
    expect(calculateAffiliateCommission(0, 10)).toBe(0);
    expect(calculateAffiliateCommission(500, 0)).toBe(0);
  });

  it("calculates commission on discounted finalPrice and caps partial payments", () => {
    // Booking basePrice 1000, discounted finalPrice 800
    // Payment 1: 500 -> eligible 500, 10% = 50
    const p1 = calculateCappedPaymentCommission({
      paymentAmount: 500,
      bookingEligibleTotal: 800,
      alreadyCommissionedEligibleAmount: 0,
      ratePercent: 10,
    });
    expect(p1).toEqual({ eligibleAmount: 500, commissionAmount: 50 });

    // Payment 2: 400 (exceeds remaining 300) -> capped to eligible 300, 10% = 30
    const p2 = calculateCappedPaymentCommission({
      paymentAmount: 400,
      bookingEligibleTotal: 800,
      alreadyCommissionedEligibleAmount: 500,
      ratePercent: 10,
    });
    expect(p2).toEqual({ eligibleAmount: 300, commissionAmount: 30 });

    // Payment 3: 100 (already fully commissioned) -> 0
    const p3 = calculateCappedPaymentCommission({
      paymentAmount: 100,
      bookingEligibleTotal: 800,
      alreadyCommissionedEligibleAmount: 800,
      ratePercent: 10,
    });
    expect(p3).toEqual({ eligibleAmount: 0, commissionAmount: 0 });
  });

  it("calculates full and partial refund reversals capped at net earned commission", () => {
    // Partial refund of 200 at 10% = -20
    expect(
      calculateRefundReversal({
        refundAmount: 200,
        originalRatePercent: 10,
        netEarnedCommissionForBooking: 80,
      })
    ).toBe(-20);

    // Full/over refund capped at remaining net earned (-60)
    expect(
      calculateRefundReversal({
        refundAmount: 1000,
        originalRatePercent: 10,
        netEarnedCommissionForBooking: 60,
      })
    ).toBe(-60);
  });

  it("calculates affiliate balances accurately with reserved and paid payouts", () => {
    const balances = calculateAffiliateBalances({
      availableLedgerSum: 500,
      pendingLedgerSum: 120,
      reservedPayoutsSum: 150,
      paidPayoutsSum: 200,
    });
    expect(balances).toEqual({
      totalEarned: 620,
      pendingCommission: 120,
      reservedForPayout: 150,
      paidCommission: 200,
      availableBalance: 150, // 500 - 150 - 200
    });
  });

  it("generates unique uppercase referral codes", () => {
    const c1 = generateAffiliateCode();
    const c2 = generateAffiliateCode();
    expect(c1).toMatch(/^AFF[A-Z0-9]{6}$/);
    expect(c1).not.toBe(c2);
  });
});

describe("affiliateAttribution cookie signing", () => {
  it("signs and verifies valid attribution tokens", () => {
    const payload = {
      clickId: "click-1",
      affiliateId: "aff-1",
      code: "AFF1025",
      exp: Date.now() + 60_000,
    };
    const token = signAttributionToken(payload);
    const verified = verifyAttributionToken(token);
    expect(verified).toEqual(payload);
  });

  it("rejects tampered tokens and expired tokens", () => {
    const payload = {
      clickId: "click-1",
      affiliateId: "aff-1",
      code: "AFF1025",
      exp: Date.now() + 60_000,
    };
    const token = signAttributionToken(payload);
    expect(verifyAttributionToken(`${token}tampered`)).toBeNull();

    const expiredToken = signAttributionToken({
      ...payload,
      exp: Date.now() - 1000,
    });
    expect(verifyAttributionToken(expiredToken)).toBeNull();
  });
});
