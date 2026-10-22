import { describe, it, expect, vi, beforeEach } from "vitest";
import AppError from "../../../../shared/utils/AppError.js";
import * as pricingRepository from "../../pricingRepository.js";
import * as pricingService from "../../pricingService.js";

vi.mock("../../pricingRepository.js");

const repo = vi.mocked(pricingRepository);

const AGENT_ID = "agent-1";
const BOOKING_ID = "booking-1";
const SERVICE_ID = "service-1";

const makeBooking = (overrides: Record<string, unknown> = {}) =>
  ({
    id: BOOKING_ID,
    agentId: AGENT_ID,
    serviceId: SERVICE_ID,
    basePrice: "500.00",
    proposedPrice: null,
    finalPrice: "500.00",
    status: "PENDING",
    paymentStatus: "UNPAID",
    requiresApproval: false,
    priceApproval: null,
    ...overrides,
  }) as any;

const expectAppError = async (promise: Promise<unknown>, statusCode: number) => {
  await expect(promise).rejects.toBeInstanceOf(AppError);
  await expect(promise).rejects.toMatchObject({ statusCode });
};

describe("pricingService.proposeBookingPrice", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    repo.getAgentPricingLimit.mockResolvedValue({
      maxDiscountPercentage: 10,
      ruleId: "rule-1",
    } as any);
    repo.applyAgentPriceProposal.mockImplementation(async (params: any) =>
      makeBooking({ requiresApproval: params.requiresApproval }),
    );
  });

  it("returns 404 when the booking does not exist", async () => {
    repo.findBookingWithApproval.mockResolvedValue(null);
    await expectAppError(pricingService.proposeBookingPrice(AGENT_ID, BOOKING_ID, { price: 450 }), 404);
  });

  it("returns 404 when the booking belongs to another agent", async () => {
    repo.findBookingWithApproval.mockResolvedValue(makeBooking({ agentId: "other-agent" }));
    await expectAppError(pricingService.proposeBookingPrice(AGENT_ID, BOOKING_ID, { price: 450 }), 404);
    expect(repo.applyAgentPriceProposal).not.toHaveBeenCalled();
  });

  it("returns 404 when the booking has no agent", async () => {
    repo.findBookingWithApproval.mockResolvedValue(makeBooking({ agentId: null }));
    await expectAppError(pricingService.proposeBookingPrice(AGENT_ID, BOOKING_ID, { price: 450 }), 404);
  });

  it.each(["CONFIRMED", "IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED"])(
    "returns 409 when the booking status is %s",
    async (status) => {
      repo.findBookingWithApproval.mockResolvedValue(makeBooking({ status }));
      await expectAppError(pricingService.proposeBookingPrice(AGENT_ID, BOOKING_ID, { price: 450 }), 409);
      expect(repo.applyAgentPriceProposal).not.toHaveBeenCalled();
    },
  );

  it.each(["PARTIALLY_PAID", "PAID"])("returns 409 when payment status is %s", async (paymentStatus) => {
    repo.findBookingWithApproval.mockResolvedValue(makeBooking({ paymentStatus }));
    await expectAppError(pricingService.proposeBookingPrice(AGENT_ID, BOOKING_ID, { price: 450 }), 409);
  });

  it("returns 400 when the price is higher than the base price", async () => {
    repo.findBookingWithApproval.mockResolvedValue(makeBooking());
    await expectAppError(pricingService.proposeBookingPrice(AGENT_ID, BOOKING_ID, { price: 500.01 }), 400);
  });

  it("looks up the limit using the booking's service", async () => {
    repo.findBookingWithApproval.mockResolvedValue(makeBooking());
    await pricingService.proposeBookingPrice(AGENT_ID, BOOKING_ID, { price: 450 });
    expect(repo.getAgentPricingLimit).toHaveBeenCalledWith(AGENT_ID, SERVICE_ID);
  });

  it("accepts a price exactly at the discount limit without approval", async () => {
    repo.findBookingWithApproval.mockResolvedValue(makeBooking());
    await pricingService.proposeBookingPrice(AGENT_ID, BOOKING_ID, { price: 450 });
    expect(repo.applyAgentPriceProposal).toHaveBeenCalledWith(
      expect.objectContaining({ price: 450, requiresApproval: false, bookingId: BOOKING_ID, agentId: AGENT_ID }),
    );
  });

  it("requires approval for a price one cent beyond the limit", async () => {
    repo.findBookingWithApproval.mockResolvedValue(makeBooking());
    await pricingService.proposeBookingPrice(AGENT_ID, BOOKING_ID, { price: 449.99 });
    expect(repo.applyAgentPriceProposal).toHaveBeenCalledWith(
      expect.objectContaining({ price: 449.99, requiresApproval: true }),
    );
  });

  it("accepts the base price itself without approval", async () => {
    repo.findBookingWithApproval.mockResolvedValue(makeBooking());
    repo.getAgentPricingLimit.mockResolvedValue({ maxDiscountPercentage: 0, ruleId: null } as any);
    await pricingService.proposeBookingPrice(AGENT_ID, BOOKING_ID, { price: 500 });
    expect(repo.applyAgentPriceProposal).toHaveBeenCalledWith(expect.objectContaining({ requiresApproval: false }));
  });

  it("requires approval for any discount when no rule applies", async () => {
    repo.findBookingWithApproval.mockResolvedValue(makeBooking());
    repo.getAgentPricingLimit.mockResolvedValue({ maxDiscountPercentage: 0, ruleId: null } as any);
    await pricingService.proposeBookingPrice(AGENT_ID, BOOKING_ID, { price: 499.99 });
    expect(repo.applyAgentPriceProposal).toHaveBeenCalledWith(expect.objectContaining({ requiresApproval: true }));
  });

  it("handles fractional limits without float errors", async () => {
    repo.findBookingWithApproval.mockResolvedValue(makeBooking({ basePrice: "199.99" }));
    repo.getAgentPricingLimit.mockResolvedValue({ maxDiscountPercentage: 12.5, ruleId: "rule-1" } as any);
    // 12.5% of 199.99 = 24.99875, minimum auto-approved = ceil(174.99125 * 100) = 17500 cents
    await pricingService.proposeBookingPrice(AGENT_ID, BOOKING_ID, { price: 175 });
    expect(repo.applyAgentPriceProposal).toHaveBeenLastCalledWith(expect.objectContaining({ requiresApproval: false }));
    await pricingService.proposeBookingPrice(AGENT_ID, BOOKING_ID, { price: 174.99 });
    expect(repo.applyAgentPriceProposal).toHaveBeenLastCalledWith(expect.objectContaining({ requiresApproval: true }));
  });

  it("records the discount details and notes in the history changes", async () => {
    repo.findBookingWithApproval.mockResolvedValue(makeBooking());
    await pricingService.proposeBookingPrice(AGENT_ID, BOOKING_ID, { price: 450, notes: "Repeat customer" });
    expect(repo.applyAgentPriceProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          basePrice: 500,
          proposedPrice: 450,
          discountPercentage: 10,
          maxDiscountPercentage: 10,
          applicableRuleId: "rule-1",
          requiresApproval: false,
          notes: "Repeat customer",
        }),
      }),
    );
  });

  it("returns 409 when the booking changed during the update", async () => {
    repo.findBookingWithApproval.mockResolvedValue(makeBooking());
    repo.applyAgentPriceProposal.mockResolvedValue(null);
    await expectAppError(pricingService.proposeBookingPrice(AGENT_ID, BOOKING_ID, { price: 450 }), 409);
  });

  it("allows re-negotiating while the booking is AWAITING_APPROVAL", async () => {
    repo.findBookingWithApproval.mockResolvedValue(makeBooking({ status: "AWAITING_APPROVAL", requiresApproval: true }));
    await pricingService.proposeBookingPrice(AGENT_ID, BOOKING_ID, { price: 440 });
    expect(repo.applyAgentPriceProposal).toHaveBeenCalled();
  });
});

describe("pricingService.reviewPriceApproval", () => {
  const ADMIN_ID = "admin-1";

  const pendingBooking = (overrides: Record<string, unknown> = {}) =>
    makeBooking({
      status: "AWAITING_APPROVAL",
      requiresApproval: true,
      proposedPrice: "400.00",
      priceApproval: { id: "approval-1", bookingId: BOOKING_ID, requestedPrice: "400.00", status: "PENDING" },
      ...overrides,
    });

  beforeEach(() => {
    vi.resetAllMocks();
    repo.applyPriceApprovalDecision.mockResolvedValue(
      makeBooking({ priceApproval: { status: "APPROVED" } }),
    );
  });

  it("returns 404 when the booking does not exist", async () => {
    repo.findBookingWithApproval.mockResolvedValue(null);
    await expectAppError(pricingService.reviewPriceApproval(ADMIN_ID, BOOKING_ID, { decision: "APPROVED" }), 404);
  });

  it("returns 409 when there is no approval record", async () => {
    repo.findBookingWithApproval.mockResolvedValue(pendingBooking({ priceApproval: null }));
    await expectAppError(pricingService.reviewPriceApproval(ADMIN_ID, BOOKING_ID, { decision: "APPROVED" }), 409);
  });

  it("returns 409 when the approval was already reviewed", async () => {
    repo.findBookingWithApproval.mockResolvedValue(
      pendingBooking({ priceApproval: { requestedPrice: "400.00", status: "APPROVED" } }),
    );
    await expectAppError(pricingService.reviewPriceApproval(ADMIN_ID, BOOKING_ID, { decision: "APPROVED" }), 409);
  });

  it("returns 409 when the booking is not awaiting approval", async () => {
    repo.findBookingWithApproval.mockResolvedValue(pendingBooking({ status: "PENDING" }));
    await expectAppError(pricingService.reviewPriceApproval(ADMIN_ID, BOOKING_ID, { decision: "APPROVED" }), 409);
  });

  it("approves the requested price by default", async () => {
    repo.findBookingWithApproval.mockResolvedValue(pendingBooking());
    await pricingService.reviewPriceApproval(ADMIN_ID, BOOKING_ID, { decision: "APPROVED", notes: "OK" });
    expect(repo.applyPriceApprovalDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: BOOKING_ID,
        adminId: ADMIN_ID,
        decision: "APPROVED",
        approvedPrice: 400,
        notes: "OK",
      }),
    );
  });

  it("accepts a counter price between the requested and base price", async () => {
    repo.findBookingWithApproval.mockResolvedValue(pendingBooking());
    await pricingService.reviewPriceApproval(ADMIN_ID, BOOKING_ID, { decision: "APPROVED", approvedPrice: 480 });
    expect(repo.applyPriceApprovalDecision).toHaveBeenCalledWith(expect.objectContaining({ approvedPrice: 480 }));
  });

  it("accepts a counter price equal to the base price", async () => {
    repo.findBookingWithApproval.mockResolvedValue(pendingBooking());
    await pricingService.reviewPriceApproval(ADMIN_ID, BOOKING_ID, { decision: "APPROVED", approvedPrice: 500 });
    expect(repo.applyPriceApprovalDecision).toHaveBeenCalledWith(expect.objectContaining({ approvedPrice: 500 }));
  });

  it("rejects a counter price below the requested price", async () => {
    repo.findBookingWithApproval.mockResolvedValue(pendingBooking());
    await expectAppError(
      pricingService.reviewPriceApproval(ADMIN_ID, BOOKING_ID, { decision: "APPROVED", approvedPrice: 399.99 }),
      400,
    );
    expect(repo.applyPriceApprovalDecision).not.toHaveBeenCalled();
  });

  it("rejects a counter price above the base price", async () => {
    repo.findBookingWithApproval.mockResolvedValue(pendingBooking());
    await expectAppError(
      pricingService.reviewPriceApproval(ADMIN_ID, BOOKING_ID, { decision: "APPROVED", approvedPrice: 500.01 }),
      400,
    );
  });

  it("rejects a decision with no approved price and keeps the final price", async () => {
    repo.findBookingWithApproval.mockResolvedValue(pendingBooking());
    await pricingService.reviewPriceApproval(ADMIN_ID, BOOKING_ID, { decision: "REJECTED", notes: "Too low" });
    expect(repo.applyPriceApprovalDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "REJECTED",
        approvedPrice: null,
        changes: expect.objectContaining({ previousFinalPrice: 500, newFinalPrice: 500 }),
      }),
    );
  });

  it("returns 400 when an approved price is sent with a rejection", async () => {
    repo.findBookingWithApproval.mockResolvedValue(pendingBooking());
    await expectAppError(
      pricingService.reviewPriceApproval(ADMIN_ID, BOOKING_ID, { decision: "REJECTED", approvedPrice: 450 }),
      400,
    );
  });

  it("returns 409 when the booking changed during the review", async () => {
    repo.findBookingWithApproval.mockResolvedValue(pendingBooking());
    repo.applyPriceApprovalDecision.mockResolvedValue(null);
    await expectAppError(pricingService.reviewPriceApproval(ADMIN_ID, BOOKING_ID, { decision: "APPROVED" }), 409);
  });
});