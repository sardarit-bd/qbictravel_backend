import AppError from "../../shared/utils/AppError.js";
import { parseEnumQuery, parsePagination, parseUuidQuery } from "../../shared/utils/pagination.js";
import * as commissionRepository from "./commissionRepository.js";
import { COMMISSION_STATUSES, COMMISSION_POLICY_STATUSES } from "./commissionTypes.js";
import type {
  AdjustCommissionInput,
  CommissionFilters,
  CommissionPolicyFilters,
  ConfigureCommissionRuleInput,
  CreateCommissionPolicyInput,
  UpdateCommissionPolicyInput,
} from "./commissionTypes.js";

const toCents = (value: unknown): number => Math.round(Number(value) * 100);

const hasCode = (error: unknown, code: string): boolean =>
  typeof error === "object" && error !== null && (error as { code?: string }).code === code;

const mapCommission = (commission: any) => ({
  ...commission,
  rateValue: Number(commission.rateValue),
  baseAmount: Number(commission.baseAmount),
  amount: Number(commission.amount),
  booking: commission.booking
    ? { ...commission.booking, finalPrice: Number(commission.booking.finalPrice) }
    : undefined,
  adjustments: commission.adjustments?.map((adjustment: any) => ({
    ...adjustment,
    previousAmount: Number(adjustment.previousAmount),
    newAmount: Number(adjustment.newAmount),
  })),
});

const toAgentView = (commission: ReturnType<typeof mapCommission>) => ({
  ...commission,
  adjustments: commission.adjustments?.map(
    ({ id, previousAmount, newAmount, createdAt }: any) => ({ id, previousAmount, newAmount, createdAt }),
  ),
});

const mapRule = (rule: any) => ({
  ...rule,
  rateValue: Number(rule.rateValue),
  auditLogs: rule.auditLogs?.map((log: any) => ({
    ...log,
    admin: log.admin ? { id: log.admin.id, name: log.admin.name, email: log.admin.email } : undefined,
  })),
});

const getCommissionOr404 = async (commissionId: string) => {
  const commission = await commissionRepository.findCommissionById(commissionId);
  if (!commission) {
    throw new AppError("Commission not found", 404);
  }
  return commission;
};

const getPolicyOr404 = async (policyId: string) => {
  const rule = await commissionRepository.findRuleById(policyId);
  if (!rule) {
    throw new AppError("Commission policy not found", 404);
  }
  return rule;
};

const listWithFilters = async (base: CommissionFilters, query: Record<string, unknown>, allowAdminFilters: boolean) => {
  const { page, limit, skip } = parsePagination(query);
  const filters: CommissionFilters = {
    ...base,
    status: parseEnumQuery(query.status, COMMISSION_STATUSES, "status"),
    ...(allowAdminFilters
      ? {
          agentId: parseUuidQuery(query.agentId, "agentId"),
          bookingId: parseUuidQuery(query.bookingId, "bookingId"),
        }
      : {}),
  };

  const { items, total } = await commissionRepository.listCommissions(filters, skip, limit);
  const totalPages = Math.ceil(total / limit);
  return {
    items: items.map(mapCommission),
    page,
    limit,
    total,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
};

export const listAgentCommissions = async (agentId: string, query: Record<string, unknown>) =>
  listWithFilters({ agentId }, query, false);

export const getAgentCommission = async (agentId: string, commissionId: string) => {
  const commission = await getCommissionOr404(commissionId);
  if (commission.agentId !== agentId) {
    throw new AppError("Commission not found", 404);
  }
  return toAgentView(mapCommission(commission));
};

export const listAdminCommissions = async (query: Record<string, unknown>) => listWithFilters({}, query, true);

export const getAdminCommission = async (commissionId: string) =>
  mapCommission(await getCommissionOr404(commissionId));

export const adjustCommission = async (adminId: string, commissionId: string, input: AdjustCommissionInput) => {
  const commission = await getCommissionOr404(commissionId);

  if (commission.status !== "ACTIVE") {
    throw new AppError("Only an active commission can be adjusted", 409);
  }

  const previousCents = toCents(commission.amount);
  const newCents = toCents(input.amount);
  const baseCents = toCents(commission.baseAmount);

  if (newCents < 0 || newCents > baseCents) {
    throw new AppError("The adjusted amount must be between 0 and the booking amount", 400);
  }

  if (newCents === previousCents) {
    throw new AppError("The adjusted amount is the same as the current amount", 409);
  }

  const updated = await commissionRepository.adjustCommission({
    commissionId,
    bookingId: commission.bookingId,
    adminId,
    previousAmount: previousCents / 100,
    newAmount: newCents / 100,
    reason: input.reason,
  });

  if (!updated) {
    throw new AppError("The commission was changed by someone else. Please reload and retry.", 409);
  }

  return mapCommission(updated);
};

export const getRules = async (query: Record<string, unknown>) => {
  const { page, limit, skip } = parsePagination(query);
  const statusFilter = parseEnumQuery(query.status, COMMISSION_POLICY_STATUSES, "status");
  const filters: CommissionPolicyFilters = {
    status: statusFilter,
  };

  const [activeRule, { items, total }] = await Promise.all([
    commissionRepository.findActiveRule(),
    commissionRepository.listRules(skip, limit, filters),
  ]);

  return {
    activeRule: activeRule ? mapRule(activeRule) : null,
    items: items.map(mapRule),
    page,
    limit,
    total,
  };
};

export const getPolicyById = async (policyId: string) => {
  const rule = await getPolicyOr404(policyId);
  return mapRule(rule);
};

export const createDraftPolicy = async (adminId: string, input: CreateCommissionPolicyInput) => {
  const rule = await commissionRepository.createCommissionRule({
    name: input.name,
    description: input.description,
    rateType: input.rateType,
    rateValue: input.rateValue,
    status: input.status,
    isActive: input.isActive,
    adminId,
  });
  return mapRule(rule);
};

export const updatePolicy = async (adminId: string, policyId: string, input: UpdateCommissionPolicyInput) => {
  const rule = await getPolicyOr404(policyId);

  const previousValues = {
    name: rule.name,
    description: rule.description,
    rateType: rule.rateType,
    rateValue: Number(rule.rateValue),
    status: rule.status,
    isActive: rule.isActive,
  };

  const updated = await commissionRepository.updateCommissionRule({
    ruleId: policyId,
    adminId,
    name: input.name,
    description: input.description,
    rateType: input.rateType,
    rateValue: input.rateValue,
    status: input.status,
    isActive: input.isActive,
    previousValues,
  });

  return mapRule(updated);
};

export const publishPolicy = async (adminId: string, policyId: string) => {
  const rule = await getPolicyOr404(policyId);

  // Business Rule: Only DRAFT or INACTIVE policies can be published.
  // Archived policies cannot be activated directly.
  if (rule.status === "ARCHIVED") {
    throw new AppError("Archived policies cannot be activated directly. Create a new revision instead.", 409);
  }

  if (rule.status === "ACTIVE") {
    throw new AppError("Policy is already active.", 409);
  }

  const previousValues = {
    rateType: rule.rateType,
    rateValue: Number(rule.rateValue),
    status: rule.status,
    isActive: rule.isActive,
  };

  try {
    const published = await commissionRepository.publishPolicy({
      ruleId: policyId,
      adminId,
      previousValues,
    });
    return mapRule(published);
  } catch (error) {
    if (hasCode(error, "P2034")) {
      throw new AppError("The commission policy could not be published due to a concurrent update. Please retry.", 409);
    }
    throw error;
  }
};

export const deactivatePolicy = async (adminId: string, policyId: string) => {
  const rule = await getPolicyOr404(policyId);

  if (rule.status !== "ACTIVE") {
    throw new AppError("Only an active policy can be deactivated.", 409);
  }

  const previousValues = {
    rateType: rule.rateType,
    rateValue: Number(rule.rateValue),
    status: rule.status,
    isActive: rule.isActive,
  };

  const deactivated = await commissionRepository.deactivatePolicy({
    ruleId: policyId,
    adminId,
    previousValues,
  });

  return mapRule(deactivated);
};

export const archivePolicy = async (adminId: string, policyId: string) => {
  const rule = await getPolicyOr404(policyId);

  if (rule.status === "ACTIVE") {
    throw new AppError("Cannot archive an active policy. Please deactivate it first.", 409);
  }

  if (rule.status === "ARCHIVED") {
    throw new AppError("Policy is already archived.", 409);
  }

  const previousValues = {
    rateType: rule.rateType,
    rateValue: Number(rule.rateValue),
    status: rule.status,
    isActive: rule.isActive,
  };

  const archived = await commissionRepository.archivePolicy({
    ruleId: policyId,
    adminId,
    previousValues,
  });

  return mapRule(archived);
};

export const deletePolicy = async (adminId: string, policyId: string) => {
  const rule = await getPolicyOr404(policyId);

  // Business Rule: Do not allow deleting an active commission. Admin must deactivate it first.
  if (rule.isActive || rule.status === "ACTIVE") {
    throw new AppError("Cannot delete an active commission. Please deactivate it first.", 409);
  }

  // Business Rule: Do not delete commissions referenced by historical bookings or commission ledger entries.
  const commissionCount = await commissionRepository.countCommissionsByRuleId(policyId);
  if (commissionCount > 0) {
    throw new AppError(
      "Cannot delete this commission because it is referenced by existing bookings or commission ledger records.",
      409
    );
  }

  const previousValues = {
    name: rule.name,
    description: rule.description,
    rateType: rule.rateType,
    rateValue: Number(rule.rateValue),
    status: rule.status,
    isActive: rule.isActive,
  };

  await commissionRepository.deleteCommissionRule({
    ruleId: policyId,
    adminId,
    previousValues,
  });

  return { id: policyId, deleted: true, message: "Commission deleted successfully" };
};

export const createRevision = async (
  adminId: string,
  policyId: string,
  input?: { rateType?: string; rateValue?: number }
) => {
  const rule = await getPolicyOr404(policyId);

  const newRevision = await commissionRepository.createRevisionFromPolicy({
    sourceRuleId: policyId,
    adminId,
    rateType: (input?.rateType as any) || undefined,
    rateValue: input?.rateValue !== undefined ? input.rateValue : undefined,
    sourcePolicy: {
      rateType: rule.rateType,
      rateValue: Number(rule.rateValue),
    },
  });

  return mapRule(newRevision);
};

export const disableCommission = async (adminId: string) => {
  return commissionRepository.disableActiveCommission(adminId);
};

export const configureRule = async (adminId: string, input: ConfigureCommissionRuleInput) => {
  try {
    const rule = await commissionRepository.replaceActiveRule({
      rateType: input.rateType,
      rateValue: input.rateValue,
      adminId,
    });
    return mapRule(rule);
  } catch (error) {
    if (hasCode(error, "P2034")) {
      throw new AppError("The commission rule could not be updated right now. Please retry.", 409);
    }
    throw error;
  }
};
