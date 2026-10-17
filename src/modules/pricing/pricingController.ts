import type { Request, Response, NextFunction } from "express";
import sendResponse from "../../shared/utils/response.js";
import * as pricingService from "./pricingService.js";

export const createPricingRule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rule = await pricingService.createPricingRule(req.body);
    sendResponse(res, 201, true, "Pricing rule created successfully", rule);
  } catch (error) {
    next(error);
  }
};

export const updatePricingRule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rule = await pricingService.updatePricingRule(req.params.ruleId as string, req.body);
    sendResponse(res, 200, true, "Pricing rule updated successfully", rule);
  } catch (error) {
    next(error);
  }
};

export const listPricingRules = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rules = await pricingService.listPricingRules();
    sendResponse(res, 200, true, "Pricing rules retrieved successfully", rules);
  } catch (error) {
    next(error);
  }
};

export const getAgentPricingLimits = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const agentId = req.user!.id;
    const serviceId = req.query.serviceId as string | undefined;
    const limits = await pricingService.getAgentPricingLimit(agentId, serviceId);
    sendResponse(res, 200, true, "Agent pricing limits retrieved successfully", limits);
  } catch (error) {
    next(error);
  }
};