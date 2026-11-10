import { describe, it, expect, vi, beforeEach } from "vitest";
import AppError from "../../../../shared/utils/AppError.js";
import * as commissionRepository from "../../commissionRepository.js";
import * as commissionService from "../../commissionService.js";

vi.mock("../../commissionRepository.js");

const repo = vi.mocked(commissionRepository);

const AGENT_ID = "agent-1";
const ADMIN_ID = "admin-1";
const COMMISSION_ID = "commission-1";
const POLICY_ID = "policy-1";

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

const makePolicy = (overrides: Record<string, unknown> = {}) =>
  ({
    id: POLICY_ID,
    rateType: "PERCENTAGE",
    rateValue: "10.00",
    status: "DRAFT",
    isActive: false,
    createdById: ADMIN_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: { id: ADMIN_ID, name: "Admin User", email: "admin@test.com" },
    auditLogs: [],
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

describe("commissionService rules & policy lifecycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns the active rule with history", async () => {
    const rule = makePolicy({ status: "ACTIVE", isActive: true });
    repo.findActiveRule.mockResolvedValue(rule);
    repo.listRules.mockResolvedValue({ items: [rule], total: 1 });

    const result = await commissionService.getRules({});
    expect(result.activeRule).toMatchObject({ rateValue: 10, status: "ACTIVE" });
    expect(result.total).toBe(1);
  });

  it("returns a null active rule when none is configured", async () => {
    repo.findActiveRule.mockResolvedValue(null);
    repo.listRules.mockResolvedValue({ items: [], total: 0 });
    const result = await commissionService.getRules({});
    expect(result.activeRule).toBeNull();
  });

  it("creates a commission rule", async () => {
    const createdRule = makePolicy({ name: "Partner 10%", status: "INACTIVE", isActive: false });
    repo.createCommissionRule.mockResolvedValue(createdRule);

    const result = await commissionService.createDraftPolicy(ADMIN_ID, { name: "Partner 10%", rateType: "PERCENTAGE", rateValue: 10 });
    expect(repo.createCommissionRule).toHaveBeenCalledWith({ name: "Partner 10%", description: undefined, rateType: "PERCENTAGE", rateValue: 10, status: undefined, isActive: undefined, adminId: ADMIN_ID });
    expect(result.status).toBe("INACTIVE");
  });

  it("updates a commission rule", async () => {
    const existing = makePolicy({ name: "Old Name", status: "INACTIVE", isActive: false });
    repo.findRuleById.mockResolvedValue(existing);
    repo.updateCommissionRule.mockResolvedValue({ ...existing, name: "New Name", rateValue: "15.00" });

    const result = await commissionService.updatePolicy(ADMIN_ID, POLICY_ID, { name: "New Name", rateValue: 15 });
    expect(repo.updateCommissionRule).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: POLICY_ID, adminId: ADMIN_ID, name: "New Name", rateValue: 15 })
    );
    expect(result.rateValue).toBe(15);
  });

  it("updates an active commission rule and preserves rateValue", async () => {
    const active = makePolicy({ status: "ACTIVE", isActive: true });
    repo.findRuleById.mockResolvedValue(active);
    repo.updateCommissionRule.mockResolvedValue({ ...active, rateValue: "15.00" });

    const result = await commissionService.updatePolicy(ADMIN_ID, POLICY_ID, { rateValue: 15 });
    expect(repo.updateCommissionRule).toHaveBeenCalled();
    expect(result.rateValue).toBe(15);
  });

  it("publishes a draft policy and marks it active", async () => {
    const draft = makePolicy({ status: "DRAFT", isActive: false });
    repo.findRuleById.mockResolvedValue(draft);
    repo.publishPolicy.mockResolvedValue({ ...draft, status: "ACTIVE", isActive: true });

    const result = await commissionService.publishPolicy(ADMIN_ID, POLICY_ID);
    expect(repo.publishPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: POLICY_ID, adminId: ADMIN_ID })
    );
    expect(result.status).toBe("ACTIVE");
    expect(result.isActive).toBe(true);
  });

  it("rejects publishing an archived policy directly", async () => {
    const archived = makePolicy({ status: "ARCHIVED", isActive: false });
    repo.findRuleById.mockResolvedValue(archived);

    await expectAppError(commissionService.publishPolicy(ADMIN_ID, POLICY_ID), 409);
    expect(repo.publishPolicy).not.toHaveBeenCalled();
  });

  it("deactivates an active policy", async () => {
    const active = makePolicy({ status: "ACTIVE", isActive: true });
    repo.findRuleById.mockResolvedValue(active);
    repo.deactivatePolicy.mockResolvedValue({ ...active, status: "INACTIVE", isActive: false });

    const result = await commissionService.deactivatePolicy(ADMIN_ID, POLICY_ID);
    expect(repo.deactivatePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: POLICY_ID, adminId: ADMIN_ID })
    );
    expect(result.status).toBe("INACTIVE");
    expect(result.isActive).toBe(false);
  });

  it("rejects deactivating a policy that is not active", async () => {
    const draft = makePolicy({ status: "DRAFT", isActive: false });
    repo.findRuleById.mockResolvedValue(draft);

    await expectAppError(commissionService.deactivatePolicy(ADMIN_ID, POLICY_ID), 409);
  });

  it("archives an inactive policy", async () => {
    const inactive = makePolicy({ status: "INACTIVE", isActive: false });
    repo.findRuleById.mockResolvedValue(inactive);
    repo.archivePolicy.mockResolvedValue({ ...inactive, status: "ARCHIVED", isActive: false });

    const result = await commissionService.archivePolicy(ADMIN_ID, POLICY_ID);
    expect(repo.archivePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: POLICY_ID, adminId: ADMIN_ID })
    );
    expect(result.status).toBe("ARCHIVED");
  });

  it("rejects archiving an active policy", async () => {
    const active = makePolicy({ status: "ACTIVE", isActive: true });
    repo.findRuleById.mockResolvedValue(active);

    await expectAppError(commissionService.archivePolicy(ADMIN_ID, POLICY_ID), 409);
  });

  it("deletes an inactive unused commission rule", async () => {
    const inactive = makePolicy({ status: "INACTIVE", isActive: false });
    repo.findRuleById.mockResolvedValue(inactive);
    repo.countCommissionsByRuleId.mockResolvedValue(0);
    repo.deleteCommissionRule.mockResolvedValue({ id: POLICY_ID, deleted: true } as any);

    const result = await commissionService.deletePolicy(ADMIN_ID, POLICY_ID);
    expect(repo.deleteCommissionRule).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: POLICY_ID, adminId: ADMIN_ID })
    );
    expect(result.deleted).toBe(true);
  });

  it("rejects deleting an active commission", async () => {
    const active = makePolicy({ status: "ACTIVE", isActive: true });
    repo.findRuleById.mockResolvedValue(active);

    await expectAppError(commissionService.deletePolicy(ADMIN_ID, POLICY_ID), 409);
    expect(repo.deleteCommissionRule).not.toHaveBeenCalled();
  });

  it("rejects deleting a policy with existing commission records", async () => {
    const draft = makePolicy({ status: "DRAFT", isActive: false });
    repo.findRuleById.mockResolvedValue(draft);
    repo.countCommissionsByRuleId.mockResolvedValue(3);

    await expectAppError(commissionService.deletePolicy(ADMIN_ID, POLICY_ID), 409);
  });

  it("creates a revision from an archived policy", async () => {
    const archived = makePolicy({ status: "ARCHIVED", isActive: false, rateValue: "12.00" });
    repo.findRuleById.mockResolvedValue(archived);
    const newDraft = makePolicy({ id: "policy-rev-2", status: "DRAFT", isActive: false, rateValue: "12.00" });
    repo.createRevisionFromPolicy.mockResolvedValue(newDraft);

    const result = await commissionService.createRevision(ADMIN_ID, POLICY_ID);
    expect(repo.createRevisionFromPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRuleId: POLICY_ID, adminId: ADMIN_ID })
    );
    expect(result.status).toBe("DRAFT");
    expect(result.id).toBe("policy-rev-2");
  });

  it("disables platform commission by deactivating active rules", async () => {
    repo.disableActiveCommission.mockResolvedValue({ disabled: true, deactivatedCount: 1 });
    const result = await commissionService.disableCommission(ADMIN_ID);
    expect(repo.disableActiveCommission).toHaveBeenCalledWith(ADMIN_ID);
    expect(result.disabled).toBe(true);
  });
});
