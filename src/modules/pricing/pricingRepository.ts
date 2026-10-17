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