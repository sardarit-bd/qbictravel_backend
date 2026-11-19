import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  recordAffiliateCommissionForVerifiedPayment,
  recordAffiliateCommissionReversal,
} from "../../affiliateCommissionService.js";

function createMockTx(overrides: Record<string, any> = {}) {
  const createdCommissions: any[] = [];
  const createdAudits: any[] = [];

  const tx: any = {
    affiliateSettings: {
      findUnique: vi.fn().mockResolvedValue({
        id: "default",
        globalCommissionRate: "10.00",
        attributionWindowDays: 30,
        minimumPayoutAmount: "50.00",
        eligibleAmountPolicy: "NET_AFTER_DISCOUNTS",
        isProgramActive: true,
      }),
      create: vi.fn(),
    },
    affiliateCommission: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { eligibleAmount: "0" } }),
      create: vi.fn().mockImplementation(async ({ data }) => {
        const row = { id: `comm-${createdCommissions.length + 1}`, ...data };
        createdCommissions.push(row);
        return row;
      }),
    },
    affiliateAuditEvent: {
      create: vi.fn().mockImplementation(async ({ data }) => {
        createdAudits.push(data);
        return data;
      }),
    },
    booking: {
      findUnique: vi.fn().mockResolvedValue({
        id: "booking-1",
        customerId: "cust-1",
        agentId: null,
        source: "CUSTOMER",
        currency: "THB",
        basePrice: "1000.00",
        finalPrice: "800.00", // discounted
        affiliateAttribution: {
          affiliateId: "aff-1",
          affiliate: {
            id: "aff-1",
            userId: "aff-user-1",
            status: "APPROVED",
            commissionRateOverride: "12.50",
            user: { id: "aff-user-1", name: "Aff User", email: "aff@example.com" },
          },
        },
      }),
    },
    ...overrides,
  };

  return { tx, createdCommissions, createdAudits };
}

describe("Affiliate Payment & Refund Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates snapshotted commission on verified customer payment (PayPal or Stripe) using discounted finalPrice", async () => {
    const { tx, createdCommissions } = createMockTx();
    const res = await recordAffiliateCommissionForVerifiedPayment(tx, {
      paymentId: "pay-paypal-1",
      bookingId: "booking-1",
      paidAmount: 800,
      currency: "THB",
    });

    expect(res.created).toBe(true);
    expect(createdCommissions).toHaveLength(1);
    expect(createdCommissions[0]).toMatchObject({
      affiliateId: "aff-1",
      bookingId: "booking-1",
      paymentId: "pay-paypal-1",
      entryType: "EARNED",
      eligibleAmount: 800,
      commissionRate: 12.5,
      amount: 100, // 800 * 12.5% = 100
      idempotencyKey: "payment:pay-paypal-1:earned",
    });
  });

  it("prevents duplicate commission on repeated webhook deliveries via idempotencyKey", async () => {
    const existingRow = { id: "comm-existing", amount: 100 };
    const { tx, createdCommissions } = createMockTx();
    tx.affiliateCommission.findUnique.mockResolvedValue(existingRow);

    const res = await recordAffiliateCommissionForVerifiedPayment(tx, {
      paymentId: "pay-paypal-1",
      bookingId: "booking-1",
      paidAmount: 800,
      currency: "THB",
    });

    expect(res.created).toBe(false);
    expect(res.commission).toBe(existingRow);
    expect(createdCommissions).toHaveLength(0);
  });

  it("caps partial payments so cumulative commission never exceeds booking finalPrice", async () => {
    const { tx, createdCommissions } = createMockTx();
    // Already commissioned 600 of 800 finalPrice
    tx.affiliateCommission.aggregate.mockResolvedValue({ _sum: { eligibleAmount: "600.00" } });

    const res = await recordAffiliateCommissionForVerifiedPayment(tx, {
      paymentId: "pay-partial-2",
      bookingId: "booking-1",
      paidAmount: 500, // exceeds remaining 200
      currency: "THB",
    });

    expect(res.created).toBe(true);
    expect(createdCommissions[0].eligibleAmount).toBe(200);
    expect(createdCommissions[0].amount).toBe(25); // 200 * 12.5% = 25
  });

  it("blocks self-referral, suspended affiliate, and Agent/Admin operational bookings", async () => {
    // 1. Self-referral
    const selfCtx = createMockTx();
    selfCtx.tx.booking.findUnique.mockResolvedValue({
      id: "booking-self",
      customerId: "aff-user-1",
      agentId: null,
      source: "CUSTOMER",
      currency: "THB",
      basePrice: "1000.00",
      finalPrice: "1000.00",
      affiliateAttribution: {
        affiliateId: "aff-1",
        affiliate: { id: "aff-1", userId: "aff-user-1", status: "APPROVED", commissionRateOverride: null },
      },
    });
    expect(
      (await recordAffiliateCommissionForVerifiedPayment(selfCtx.tx, {
        paymentId: "p-self",
        bookingId: "booking-self",
        paidAmount: 1000,
        currency: "THB",
      })).created
    ).toBe(false);

    // 2. Agent booking
    const agentCtx = createMockTx();
    agentCtx.tx.booking.findUnique.mockResolvedValue({
      id: "booking-agent",
      customerId: "cust-1",
      agentId: "agent-1",
      source: "AGENT",
      currency: "THB",
      basePrice: "1000.00",
      finalPrice: "1000.00",
      affiliateAttribution: {
        affiliateId: "aff-1",
        affiliate: { id: "aff-1", userId: "aff-user-1", status: "APPROVED", commissionRateOverride: null },
      },
    });
    expect(
      (await recordAffiliateCommissionForVerifiedPayment(agentCtx.tx, {
        paymentId: "p-agent",
        bookingId: "booking-agent",
        paidAmount: 1000,
        currency: "THB",
      })).created
    ).toBe(false);

    // 3. Suspended affiliate
    const suspCtx = createMockTx();
    suspCtx.tx.booking.findUnique.mockResolvedValue({
      id: "booking-susp",
      customerId: "cust-1",
      agentId: null,
      source: "CUSTOMER",
      currency: "THB",
      basePrice: "1000.00",
      finalPrice: "1000.00",
      affiliateAttribution: {
        affiliateId: "aff-1",
        affiliate: { id: "aff-1", userId: "aff-user-1", status: "SUSPENDED", commissionRateOverride: null },
      },
    });
    expect(
      (await recordAffiliateCommissionForVerifiedPayment(suspCtx.tx, {
        paymentId: "p-susp",
        bookingId: "booking-susp",
        paidAmount: 1000,
        currency: "THB",
      })).created
    ).toBe(false);
  });

  it("handles partial refund, full refund, reversal cap, and duplicate refund idempotency without deleting history", async () => {
    const { tx, createdCommissions } = createMockTx();
    tx.affiliateCommission.findMany.mockResolvedValue([
      {
        id: "comm-1",
        affiliateId: "aff-1",
        bookingId: "booking-1",
        paymentId: "pay-1",
        entryType: "EARNED",
        commissionRate: "12.50",
        amount: "100.00",
        currency: "THB",
      },
    ]);

    // Partial refund of 400 -> -50 reversal
    const partial = await recordAffiliateCommissionReversal(tx, {
      bookingId: "booking-1",
      paymentId: "pay-1",
      refundId: "re_partial_1",
      refundAmount: 400,
      currency: "THB",
    });
    expect(partial.created).toBe(true);
    expect(createdCommissions[0]).toMatchObject({
      entryType: "REVERSAL",
      amount: -50,
      commissionRate: 12.5,
      idempotencyKey: "refund:re_partial_1:reversal",
    });

    // Duplicate refund webhook -> idempotent skip
    tx.affiliateCommission.findUnique.mockResolvedValue(createdCommissions[0]);
    const dup = await recordAffiliateCommissionReversal(tx, {
      bookingId: "booking-1",
      paymentId: "pay-1",
      refundId: "re_partial_1",
      refundAmount: 400,
      currency: "THB",
    });
    expect(dup.created).toBe(false);
    expect(createdCommissions).toHaveLength(1);

    // Second refund exceeding remaining net earned (100 - 50 = 50) -> capped at -50
    tx.affiliateCommission.findUnique.mockResolvedValue(null);
    tx.affiliateCommission.findMany.mockResolvedValue([
      {
        id: "comm-1",
        affiliateId: "aff-1",
        bookingId: "booking-1",
        paymentId: "pay-1",
        entryType: "EARNED",
        commissionRate: "12.50",
        amount: "100.00",
        currency: "THB",
      },
      {
        id: "comm-2",
        affiliateId: "aff-1",
        bookingId: "booking-1",
        paymentId: "pay-1",
        entryType: "REVERSAL",
        commissionRate: "12.50",
        amount: "-50.00",
        currency: "THB",
      },
    ]);

    const capped = await recordAffiliateCommissionReversal(tx, {
      bookingId: "booking-1",
      paymentId: "pay-1",
      refundId: "re_full_2",
      refundAmount: 800,
      currency: "THB",
    });
    expect(capped.created).toBe(true);
    expect(createdCommissions[1].amount).toBe(-50);
  });
});
