import AppError from "../../shared/utils/AppError.js";
import * as pricingRepository from "./pricingRepository.js";
import type { CreatePricingRuleInput, UpdatePricingRuleInput, AgentPricingLimit } from "./pricingTypes.js";

export const createPricingRule = async (input: CreatePricingRuleInput) => {
  return pricingRepository.createPricingRule(input);
};

export const getPricingRule = async (ruleId: string) => {
  const rule = await pricingRepository.findPricingRuleById(ruleId);
  if (!rule) {
    throw new AppError("Pricing rule not found", 404);
  }
  return rule;
};

export const updatePricingRule = async (ruleId: string, input: UpdatePricingRuleInput) => {
  await getPricingRule(ruleId);
  return pricingRepository.updatePricingRule(ruleId, input);
};

export const listPricingRules = async () => {
  return pricingRepository.listPricingRules();
};

export const getAgentPricingLimit = async (agentId: string, serviceId?: string): Promise<AgentPricingLimit> => {
  const repoResult = await pricingRepository.getAgentPricingLimit(agentId, serviceId);
  return {
    maxDiscountPercentage: repoResult.maxDiscountPercentage,
    applicableRuleId: (repoResult as any).applicableRuleId ?? (repoResult as any).ruleId ?? null,
  };
};