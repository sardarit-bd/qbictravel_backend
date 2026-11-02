import type { Request, Response, NextFunction } from "express";
import sendResponse from "../../shared/utils/response.js";
import * as commissionService from "./commissionService.js";

export const listAgentCommissions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await commissionService.listAgentCommissions(req.user!.id, req.query);
    sendResponse(res, 200, true, "Commissions retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const getAgentCommission = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const commission = await commissionService.getAgentCommission(req.user!.id, req.params.commissionId as string);
    sendResponse(res, 200, true, "Commission retrieved successfully", commission);
  } catch (error) {
    next(error);
  }
};

export const listAdminCommissions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await commissionService.listAdminCommissions(req.query);
    sendResponse(res, 200, true, "Commissions retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const getAdminCommission = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const commission = await commissionService.getAdminCommission(req.params.commissionId as string);
    sendResponse(res, 200, true, "Commission retrieved successfully", commission);
  } catch (error) {
    next(error);
  }
};

export const adjustCommission = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const commission = await commissionService.adjustCommission(
      req.user!.id,
      req.params.commissionId as string,
      req.body,
    );
    sendResponse(res, 200, true, "Commission adjusted successfully", commission);
  } catch (error) {
    next(error);
  }
};

export const getRules = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await commissionService.getRules(req.query);
    sendResponse(res, 200, true, "Commission rules retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const configureRule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rule = await commissionService.configureRule(req.user!.id, req.body);
    sendResponse(res, 200, true, "Commission rule updated successfully", rule);
  } catch (error) {
    next(error);
  }
};