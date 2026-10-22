import AppError from "../../shared/utils/AppError.js";
import { parseEnumQuery, parsePagination, parseUuidQuery } from "../../shared/utils/pagination.js";
import * as commissionRepository from "./commissionRepository.js";
import { COMMISSION_STATUSES } from "./commissionTypes.js";
import type {
  AdjustCommissionInput,
  CommissionFilters,
  ConfigureCommissionRuleInput,
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

const mapRule = (rule: any) => ({ ...rule, rateValue: Number(rule.rateValue) });

const getCommissionOr404 = async (commissionId: string) => {
  const commission = await commissionRepository.findCommissionById(commissionId);
  if (!commission) {
    throw new AppError("Commission not found", 404);
  }
  return commission;
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
  return { items: items.map(mapCommission), page, limit, total };
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
  const [activeRule, { items, total }] = await Promise.all([
    commissionRepository.findActiveRule(),
    commissionRepository.listRules(skip, limit),
  ]);

  return {
    activeRule: activeRule ? mapRule(activeRule) : null,
    items: items.map(mapRule),
    page,
    limit,
    total,
  };
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