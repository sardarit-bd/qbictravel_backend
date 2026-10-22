import type { Request, Response, NextFunction } from "express";
import sendResponse from "../../shared/utils/response.js";
import * as paymentService from "./paymentService.js";

export const createPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payment = await paymentService.createPayment(
      req.user!.id,
      req.params.bookingId as string,
      req.body,
    );
    const message =
      payment.status === "SUBMITTED"
        ? "Payment receipt submitted and awaiting verification"
        : "Payment initiated";
    sendResponse(res, 201, true, message, payment);
  } catch (error) {
    next(error);
  }
};

export const listCustomerPayments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await paymentService.listCustomerPayments(req.user!.id, req.query);
    sendResponse(res, 200, true, "Payments retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const getCustomerPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payment = await paymentService.getCustomerPayment(req.user!.id, req.params.paymentId as string);
    sendResponse(res, 200, true, "Payment retrieved successfully", payment);
  } catch (error) {
    next(error);
  }
};

export const listAgentPayments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await paymentService.listAgentPayments(req.user!.id, req.query);
    sendResponse(res, 200, true, "Payments retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const listAdminPayments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await paymentService.listAdminPayments(req.query);
    sendResponse(res, 200, true, "Payments retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const getAdminPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payment = await paymentService.getAdminPayment(req.params.paymentId as string);
    sendResponse(res, 200, true, "Payment retrieved successfully", payment);
  } catch (error) {
    next(error);
  }
};

export const verifyPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payment = await paymentService.verifyPayment(
      req.user!.id,
      req.params.paymentId as string,
      req.body,
    );
    const message = payment.status === "VERIFIED" ? "Payment verified successfully" : "Payment rejected successfully";
    sendResponse(res, 200, true, message, payment);
  } catch (error) {
    next(error);
  }
};

export const recordPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payment = await paymentService.recordPayment(
      req.user!.id,
      req.params.paymentId as string,
      req.body,
    );
    sendResponse(res, 200, true, "Payment recorded successfully", payment);
  } catch (error) {
    next(error);
  }
};