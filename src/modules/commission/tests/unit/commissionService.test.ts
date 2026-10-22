import { describe, it, expect, vi, beforeEach } from "vitest";
import AppError from "../../../../shared/utils/AppError.js";
import * as commissionRepository from "../../commissionRepository.js";
import * as commissionService from "../../commissionService.js";

vi.mock("../../commissionRepository.js");

const repo = vi.mocked(commissionRepository);

const AGENT_ID = "agent-1";
const ADMIN_ID = "admin-1";
const COMMISSION_ID = "commission-1";

const makeCommission = (overrides: Record<string, unknown> = {}) =>
  ({
    id: COMMISSION_ID,
    bookingId: "booking-1",
    agentId: AGENT_ID,
    ruleId: "rule-1",
    rateType: "PERCENTAGE",
    rateValue: "10.00",
    baseAmount: "450.00",
    amount: "45.00",
    status: "ACTIVE",
    booking: { id: "booking-1", finalPrice: "450.00" },
    adjustments: [
      { id: "adj-1", previousAmount: "50.00", newAmount: "45.00", reason: "Internal", adminId: ADMIN_ID, createdAt: new Date() },
    ],
    ...overrides,
  }) as any;

const expectAppError = async (promise: Promise<unknown>, statusCode: number) => {
  await expect(promise).rejects.toBeInstanceOf(AppError);
  await expect(promise).rejects.toMatchObject({ statusCode });
};

describe("commissionService reads", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    repo.listCommissions.mockResolvedValue({ items: [makeCommission()], total: 1 });
    repo.findCommissionById.mockResolvedValue(makeCommission());
  });

  it("forces the agent id on the agent list and ignores a query agentId", async () => {
    await commissionService.listAgentCommissions(AGENT_ID, { agentId: "someone-else" });
    expect(repo.listCommissions).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: AGENT_ID }),
      0,
      20,
    );
  });

  it("maps decimal fields to numbers", async () => {
    const result = await commissionService.listAdminCommissions({});
    expect(result.items[0]).toMatchObject({ amount: 45, baseAmount: 450, rateValue: 10 });
  });

  it("returns 400 for an invalid status", async () => {
    await expectAppError(commissionService.listAdminCommissions({ status: "BAD" }), 400);
  });

  it("returns 404 when an agent requests another agent's commission", async () => {
    await expectAppError(commissionService.getAgentCommission("agent-2", COMMISSION_ID), 404);
  });

  it("hides the reason and admin id from the agent view", async () => {
    const result = await commissionService.getAgentCommission(AGENT_ID, COMMISSION_ID);
    expect(result.adjustments?.[0]).toEqual(
      expect.objectContaining({ id: "adj-1", previousAmount: 50, newAmount: 45 }),
    );
    expect(result.adjustments?.[0]).not.toHaveProperty("reason");
    expect(result.adjustments?.[0]).not.toHaveProperty("adminId");
  });

  it("shows the full adjustment to an admin", async () => {
    const result = await commissionService.getAdminCommission(COMMISSION_ID);
    expect(result.adjustments?.[0]).toHaveProperty("reason", "Internal");
  });

  it("returns 404 for an unknown commission", async () => {
    repo.findCommissionById.mockResolvedValue(null);
    await expectAppError(commissionService.getAdminCommission(COMMISSION_ID), 404);
  });
});

describe("commissionService.adjustCommission", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    repo.findCommissionById.mockResolvedValue(makeCommission());
    repo.adjustCommission.mockResolvedValue(makeCommission({ amount: "40.00" }));
  });

  it("returns 404 for an unknown commission", async () => {
    repo.findCommissionById.mockResolvedValue(null);
    await expectAppError(commissionService.adjustCommission(ADMIN_ID, COMMISSION_ID, { amount: 40, reason: "Reason" }), 404);
  });

  it("returns 409 for a cancelled commission", async () => {
    repo.findCommissionById.mockResolvedValue(makeCommission({ status: "CANCELLED" }));
    await expectAppError(commissionService.adjustCommission(ADMIN_ID, COMMISSION_ID, { amount: 40, reason: "Reason" }), 409);
  });

  it("returns 400 when the amount exceeds the booking amount", async () => {
    await expectAppError(commissionService.adjustCommission(ADMIN_ID, COMMISSION_ID, { amount: 450.01, reason: "Reason" }), 400);
  });

  it("returns 400 for a negative amount", async () => {
    await expectAppError(commissionService.adjustCommission(ADMIN_ID, COMMISSION_ID, { amount: -1, reason: "Reason" }), 400);
  });

  it("returns 409 when the amount is unchanged", async () => {
    await expectAppError(commissionService.adjustCommission(ADMIN_ID, COMMISSION_ID, { amount: 45, reason: "Reason" }), 409);
    expect(repo.adjustCommission).not.toHaveBeenCalled();
  });

  it("returns 409 when the commission changed during the update", async () => {
    repo.adjustCommission.mockResolvedValue(null);
    await expectAppError(commissionService.adjustCommission(ADMIN_ID, COMMISSION_ID, { amount: 40, reason: "Reason" }), 409);
  });

  it("adjusts and passes the audit details to the repository", async () => {
    const result = await commissionService.adjustCommission(ADMIN_ID, COMMISSION_ID, { amount: 40, reason: "Discount" });
    expect(repo.adjustCommission).toHaveBeenCalledWith({
      commissionId: COMMISSION_ID,
      bookingId: "booking-1",
      adminId: ADMIN_ID,
      previousAmount: 45,
      newAmount: 40,
      reason: "Discount",
    });
    expect(result.amount).toBe(40);
  });
});

describe("commissionService rules", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns the active rule with history", async () => {
    const rule = { id: "rule-1", rateType: "PERCENTAGE", rateValue: "10.00", isActive: true };
    repo.findActiveRule.mockResolvedValue(rule as any);
    repo.listRules.mockResolvedValue({ items: [rule] as any, total: 1 });

    const result = await commissionService.getRules({});
    expect(result.activeRule).toMatchObject({ rateValue: 10 });
    expect(result.total).toBe(1);
  });

  it("returns a null active rule when none is configured", async () => {
    repo.findActiveRule.mockResolvedValue(null);
    repo.listRules.mockResolvedValue({ items: [], total: 0 });
    const result = await commissionService.getRules({});
    expect(result.activeRule).toBeNull();
  });

  it("configures a rule", async () => {
    repo.replaceActiveRule.mockResolvedValue({ id: "rule-2", rateType: "FIXED", rateValue: "25.00" } as any);
    const result = await commissionService.configureRule(ADMIN_ID, { rateType: "FIXED", rateValue: 25 });
    expect(repo.replaceActiveRule).toHaveBeenCalledWith({ rateType: "FIXED", rateValue: 25, adminId: ADMIN_ID });
    expect(result.rateValue).toBe(25);
  });

  it("returns 409 on a serialization conflict", async () => {
    repo.replaceActiveRule.mockRejectedValue(Object.assign(new Error("conflict"), { code: "P2034" }));
    await expectAppError(commissionService.configureRule(ADMIN_ID, { rateType: "FIXED", rateValue: 25 }), 409);
  });
});