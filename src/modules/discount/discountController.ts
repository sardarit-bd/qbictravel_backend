import type { Request, Response, NextFunction } from "express";
import sendResponse from "../../shared/utils/response.js";
import * as discountService from "./discountService.js";

export const createStaffDiscountRequest = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const bookingId = req.params.bookingId as string;
    const result = await discountService.createStaffDiscountRequest(
      bookingId,
      req.body,
      { id: req.user!.id, role: req.user!.role }
    );
    sendResponse(res, 201, true, "Staff discount request submitted successfully", result);
  } catch (error) {
    next(error);
  }
};

export const listStaffDiscountRequests = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const result = await discountService.listStaffDiscountRequests(req.query as any);
    sendResponse(res, 200, true, "Discount requests retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const getStaffDiscountSummary = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const result = await discountService.getStaffDiscountSummary();
    sendResponse(res, 200, true, "Discount summary retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const reviewStaffDiscountRequest = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const requestId = req.params.requestId as string;
    const result = await discountService.reviewStaffDiscountRequest(
      requestId,
      req.body,
      { id: req.user!.id, role: req.user!.role }
    );
    sendResponse(res, 200, true, "Discount request reviewed successfully", result);
  } catch (error) {
    next(error);
  }
};
