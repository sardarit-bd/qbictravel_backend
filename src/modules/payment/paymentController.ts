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

export const createStripeSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await paymentService.createStripeCheckoutSession(req.user!.id, {
      bookingId: req.params.bookingId as string,
      successUrl: req.body?.successUrl,
      cancelUrl: req.body?.cancelUrl,
    });
    sendResponse(res, 200, true, "Stripe checkout session initialized successfully", result);
  } catch (error) {
    next(error);
  }
};

export const createAgentPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payment = await paymentService.createAgentPayment(
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

export const createAgentStripeSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await paymentService.createAgentStripeCheckoutSession(req.user!.id, {
      bookingId: req.params.bookingId as string,
      successUrl: req.body?.successUrl,
      cancelUrl: req.body?.cancelUrl,
    });
    sendResponse(res, 200, true, "Stripe checkout session initialized successfully", result);
  } catch (error) {
    next(error);
  }
};

export const handleStripeWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const signature = (req.headers["stripe-signature"] as string) || "";
    // Note: req.body is the Buffer when handled by express.raw()
    const rawBody = req.body as Buffer;
    const result = await paymentService.handleStripeWebhook(rawBody, signature);
    sendResponse(res, 200, true, "Stripe webhook processed successfully", result);
  } catch (error) {
    next(error);
  }
};

export const reconcilePayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const requester = req.user ? { id: req.user.id, role: req.user.role } : undefined;
    const result = await paymentService.reconcileStripePayment(req.params.paymentId as string, requester);
    sendResponse(res, 200, true, "Payment reconciled successfully", result);
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

// ── CUSTOMER PAYMENT LINK CONTROLLER ACTIONS ───────────────────────────────

export const generateAgentPaymentLink = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await paymentService.generateAgentPaymentLink(
      req.user!.id,
      req.params.bookingId as string,
      req.body?.expiresInDays,
    );
    sendResponse(res, 200, true, "Customer payment link generated successfully", result);
  } catch (error) {
    next(error);
  }
};

export const getPublicPaymentLinkDetails = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await paymentService.getPublicPaymentLinkDetails(req.params.token as string);
    sendResponse(res, 200, true, "Payment link details retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const createPublicStripeSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await paymentService.createPublicStripeCheckoutSession(req.params.token as string, {
      successUrl: req.body?.successUrl,
      cancelUrl: req.body?.cancelUrl,
    });
    sendResponse(res, 200, true, "Stripe checkout session initialized successfully", result);
  } catch (error) {
    next(error);
  }
};

export const createPublicPayPalOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await paymentService.createPublicPayPalOrder(req.params.token as string, {
      returnUrl: req.body?.returnUrl,
      cancelUrl: req.body?.cancelUrl,
    });
    sendResponse(res, 200, true, "PayPal order created successfully", result);
  } catch (error) {
    next(error);
  }
};

export const capturePublicPayPalOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await paymentService.capturePublicPayPalOrder(
      req.params.token as string,
      req.body?.orderId as string,
    );
    sendResponse(res, 200, true, "PayPal payment captured successfully", result);
  } catch (error) {
    next(error);
  }
};

export const handlePayPalWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await paymentService.handlePayPalWebhook(req.headers as any, req.body);
    sendResponse(res, 200, true, "PayPal webhook processed successfully", result);
  } catch (error) {
    next(error);
  }
};
