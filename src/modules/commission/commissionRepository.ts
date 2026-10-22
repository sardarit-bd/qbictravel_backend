import { prisma } from "../../lib/prisma.js";
import logger from "../../shared/logger/logger.js";
import { calculateCommissionAmount } from "./commissionCalculator.js";
import type { CommissionFilters, CommissionRateTypeValue } from "./commissionTypes.js";

type HistoryChanges = Record<string, string | number | boolean | null>;
type CommissionTx = Pick<typeof prisma, "booking" | "commission" | "commissionRule">;

const commissionSelect = {
  id: true,
  bookingId: true,
  agentId: true,
  ruleId: true,
  rateType: true,
  rateValue: true,
  baseAmount: true,
  amount: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  agent: { select: { id: true, name: true } },
  booking: { select: { id: true, serviceId: true, status: true, paymentStatus: true, finalPrice: true } },
} as const;

const commissionDetailSelect = {
  ...commissionSelect,
  adjustments: {
    orderBy: { createdAt: "desc" },
    select: { id: true, previousAmount: true, newAmount: true, reason: true, adminId: true, createdAt: true },
  },
} as const;

const ruleSelect = {
  id: true,
  rateType: true,
  rateValue: true,
  isActive: true,
  createdById: true,
  createdAt: true,
} as const;

export const listCommissions = async (filters: CommissionFilters, skip: number, take: number) => {
  const where = {
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    ...(filters.bookingId ? { bookingId: filters.bookingId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.commission.findMany({
      where,
      select: commissionSelect,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.commission.count({ where }),
  ]);

  return { items, total };
};

export const findCommissionById = async (commissionId: string) => {
  return prisma.commission.findUnique({
    where: { id: commissionId },
    select: commissionDetailSelect,
  });
};

export const findActiveRule = async () => {
  return prisma.commissionRule.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
    select: ruleSelect,
  });
};

export const listRules = async (skip: number, take: number) => {
  const [items, total] = await Promise.all([
    prisma.commissionRule.findMany({
      select: ruleSelect,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.commissionRule.count(),
  ]);

  return { items, total };
};

export const replaceActiveRule = async (params: {
  rateType: CommissionRateTypeValue;
  rateValue: number;
  adminId: string;
}) => {
  return prisma.$transaction(
    async (tx) => {
      await tx.commissionRule.updateMany({ where: { isActive: true }, data: { isActive: false } });

      return tx.commissionRule.create({
        data: {
          rateType: params.rateType,
          rateValue: params.rateValue,
          isActive: true,
          createdById: params.adminId,
        },
        select: ruleSelect,
      });
    },
    { isolationLevel: "Serializable" },
  );
};

export const adjustCommission = async (params: {
  commissionId: string;
  bookingId: string;
  adminId: string;
  previousAmount: number;
  newAmount: number;
  reason: string;
}) => {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.commission.updateMany({
      where: { id: params.commissionId, status: "ACTIVE", amount: params.previousAmount },
      data: { amount: params.newAmount },
    });

    if (updated.count === 0) {
      return null;
    }

    await tx.commissionAdjustment.create({
      data: {
        commissionId: params.commissionId,
        adminId: params.adminId,
        previousAmount: params.previousAmount,
        newAmount: params.newAmount,
        reason: params.reason,
      },
    });

    const changes: HistoryChanges = {
      commissionId: params.commissionId,
      previousAmount: params.previousAmount,
      newAmount: params.newAmount,
      reason: params.reason,
    };

    await tx.bookingHistory.create({
      data: {
        bookingId: params.bookingId,
        actorId: params.adminId,
        actorRole: "admin",
        action: "COMMISSION_ADJUSTED",
        changes,
      },
    });

    return tx.commission.findUniqueOrThrow({
      where: { id: params.commissionId },
      select: commissionDetailSelect,
    });
  });
};

/**
 * Called inside the payment verification transaction. Creates one commission per
 * booking when the booking has an agent and an active commission rule exists.
 */
export const createCommissionForBooking = async (tx: CommissionTx, bookingId: string) => {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, agentId: true, finalPrice: true },
  });

  if (!booking || !booking.agentId) {
    return null;
  }

  const existing = await tx.commission.findUnique({ where: { bookingId }, select: { id: true } });
  if (existing) {
    return null;
  }

  const rule = await tx.commissionRule.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });

  if (!rule) {
    logger.warn({ bookingId }, "No active commission rule; commission was not created");
    return null;
  }

  const baseAmount = Number(booking.finalPrice);
  const amount = calculateCommissionAmount(rule.rateType, Number(rule.rateValue), baseAmount);

  return tx.commission.create({
    data: {
      bookingId,
      agentId: booking.agentId,
      ruleId: rule.id,
      rateType: rule.rateType,
      rateValue: rule.rateValue,
      baseAmount,
      amount,
    },
  });
};