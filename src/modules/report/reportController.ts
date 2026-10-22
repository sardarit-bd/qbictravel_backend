import type { Request, Response, NextFunction } from "express";
import sendResponse from "../../shared/utils/response.js";
import * as reportService from "./reportService.js";

export const adminBookingsReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendResponse(res, 200, true, "Bookings report retrieved successfully", await reportService.getAdminBookingsReport(req.query));
  } catch (error) {
    next(error);
  }
};

export const adminRevenueReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendResponse(res, 200, true, "Revenue report retrieved successfully", await reportService.getAdminRevenueReport(req.query));
  } catch (error) {
    next(error);
  }
};

export const adminPaymentsReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendResponse(res, 200, true, "Payments report retrieved successfully", await reportService.getAdminPaymentsReport(req.query));
  } catch (error) {
    next(error);
  }
};

export const adminServicesReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendResponse(res, 200, true, "Services report retrieved successfully", await reportService.getAdminServicesReport(req.query));
  } catch (error) {
    next(error);
  }
};

export const adminAgentsReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendResponse(res, 200, true, "Agents report retrieved successfully", await reportService.getAdminAgentsReport(req.query));
  } catch (error) {
    next(error);
  }
};

export const adminCommissionsReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendResponse(res, 200, true, "Commissions report retrieved successfully", await reportService.getAdminCommissionsReport(req.query));
  } catch (error) {
    next(error);
  }
};

export const agentBookingsReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendResponse(res, 200, true, "Bookings report retrieved successfully", await reportService.getAgentBookingsReport(req.user!.id, req.query));
  } catch (error) {
    next(error);
  }
};

export const agentRevenueReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendResponse(res, 200, true, "Revenue report retrieved successfully", await reportService.getAgentRevenueReport(req.user!.id, req.query));
  } catch (error) {
    next(error);
  }
};

export const agentCommissionsReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    sendResponse(res, 200, true, "Commissions report retrieved successfully", await reportService.getAgentCommissionsReport(req.user!.id, req.query));
  } catch (error) {
    next(error);
  }
};