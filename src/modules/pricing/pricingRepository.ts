import { prisma } from "../../lib/prisma.js";
import type { CreatePricingRuleInput, UpdatePricingRuleInput } from "./pricingTypes.js";

export const createPricingRule = async (input: CreatePricingRuleInput) => {
  return prisma.pricingRule.create({
    data: {
      ...input,
    },
  });
};

export const findPricingRuleById = async (ruleId: string) => {
  return prisma.pricingRule.findUnique({
    where: { id: ruleId },
  });
};

export const updatePricingRule = async (ruleId: string, input: UpdatePricingRuleInput) => {
  return prisma.pricingRule.update({
    where: { id: ruleId },
    data: { ...input },
  });
};

export const listPricingRules = async () => {
  return prisma.pricingRule.findMany({
    orderBy: { createdAt: "desc" },
  });
};

export const getAgentPricingLimit = async (agentId: string, serviceId?: string) => {
  const rules = await prisma.pricingRule.findMany({
    where: {
      type: "AGENT_DISCOUNT_LIMIT",
      isActive: true,
      OR: [
        { agentId, serviceId },
        { agentId, serviceId: null },
        { agentId: null, serviceId },
        { agentId: null, serviceId: null },
      ],
    },
  });

  // Sort by specificity: exact match (2 pts) > partial match (1 pt) > global (0 pts)
  const sortedRules = rules.sort((a, b) => {
    const aScore = (a.agentId === agentId ? 2 : 0) + (a.serviceId === serviceId ? 1 : 0);
    const bScore = (b.agentId === agentId ? 2 : 0) + (b.serviceId === serviceId ? 1 : 0);
    return bScore - aScore;
  });

  const bestRule = sortedRules[0];
  return bestRule 
    ? { maxDiscountPercentage: Number(bestRule.value), ruleId: bestRule.id } 
    : { maxDiscountPercentage: 0, ruleId: null };
};

type HistoryChanges = Record<string, string | number | boolean | null>;

export const findBookingWithApproval = async (bookingId: string) => {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    include: { priceApproval: true },
  });
};

export const applyAgentPriceProposal = async (params: {
  bookingId: string;
  agentId: string;
  price: number;
  requiresApproval: boolean;
  changes: HistoryChanges;
}) => {
  const { bookingId, agentId, price, requiresApproval, changes } = params;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.booking.updateMany({
      where: {
        id: bookingId,
        agentId,
        paymentStatus: "UNPAID",
        status: { in: ["PENDING", "AWAITING_APPROVAL"] },
      },
      data: requiresApproval
        ? { proposedPrice: price, requiresApproval: true, status: "AWAITING_APPROVAL" }
        : { proposedPrice: price, finalPrice: price, requiresApproval: false, status: "PENDING" },
    });

    if (updated.count === 0) {
      return null;
    }

    if (requiresApproval) {
      await tx.priceApproval.upsert({
        where: { bookingId },
        create: { bookingId, requestedPrice: price },
        update: {
          requestedPrice: price,
          approvedPrice: null,
          status: "PENDING",
          adminId: null,
          reviewedAt: null,
          notes: null,
        },
      });
    } else {
      await tx.priceApproval.deleteMany({ where: { bookingId } });
    }

    await tx.bookingHistory.create({
      data: {
        bookingId,
        actorId: agentId,
        actorRole: "agent",
        action: requiresApproval ? "PRICE_APPROVAL_REQUESTED" : "PRICE_UPDATED",
        changes,
      },
    });

    return tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { priceApproval: true },
    });
  });
};

export const applyPriceApprovalDecision = async (params: {
  bookingId: string;
  adminId: string;
  decision: "APPROVED" | "REJECTED";
  approvedPrice: number | null;
  notes?: string;
  changes: HistoryChanges;
}) => {
  const { bookingId, adminId, decision, approvedPrice, notes, changes } = params;

  return prisma.$transaction(async (tx) => {
    const bookingUpdate = await tx.booking.updateMany({
      where: {
        id: bookingId,
        status: "AWAITING_APPROVAL",
        priceApproval: { is: { status: "PENDING" } },
      },
      data:
        approvedPrice === null
          ? { requiresApproval: false, status: "PENDING" }
          : { finalPrice: approvedPrice, requiresApproval: false, status: "PENDING" },
    });

    if (bookingUpdate.count === 0) {
      return null;
    }

    await tx.priceApproval.update({
      where: { bookingId },
      data: {
        status: decision,
        approvedPrice,
        adminId,
        reviewedAt: new Date(),
        notes: notes ?? null,
      },
    });

    await tx.bookingHistory.create({
      data: {
        bookingId,
        actorId: adminId,
        actorRole: "admin",
        action: decision === "APPROVED" ? "PRICE_APPROVED" : "PRICE_REJECTED",
        changes,
      },
    });

    return tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { priceApproval: true },
    });
  });
};