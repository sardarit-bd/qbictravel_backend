import type { Request, Response, NextFunction } from "express";
import sendResponse from "../../shared/utils/response.js";
import * as service from "./settingService.js";
import type { ActorContext } from "./settingService.js";

const getActorContext = (req: Request): ActorContext => {
  return {
    id: req.user?.id || "system",
    name: req.user?.name || "Administrator",
    email: req.user?.email || "admin@phukettours.local",
    ipAddress: req.ip || (req.headers["x-forwarded-for"] as string) || null,
    userAgent: req.headers["user-agent"] || null,
  };
};

export const getOverview = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const overview = await service.getSettingsOverview();
    sendResponse(res, 200, true, "System settings retrieved successfully", overview);
  } catch (error) {
    next(error);
  }
};

export const updateGeneral = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const actor = getActorContext(req);
    const updated = await service.updateGeneralSettings(req.body, actor);
    sendResponse(res, 200, true, "General settings updated successfully", updated);
  } catch (error) {
    next(error);
  }
};

export const updatePayment = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const actor = getActorContext(req);
    const updated = await service.updatePaymentSettings(req.body, actor);
    sendResponse(res, 200, true, "Payment gateway settings updated successfully", updated);
  } catch (error) {
    next(error);
  }
};

export const updateWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const actor = getActorContext(req);
    const updated = await service.updateWebhookSettings(req.body, actor);
    sendResponse(res, 200, true, "Webhook configuration updated successfully", updated);
  } catch (error) {
    next(error);
  }
};

export const updateCloudinary = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const actor = getActorContext(req);
    const updated = await service.updateCloudinarySettings(req.body, actor);
    sendResponse(res, 200, true, "Cloudinary configuration updated successfully", updated);
  } catch (error) {
    next(error);
  }
};

export const testCloudinary = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const actor = getActorContext(req);
    const result = await service.testCloudinaryConnection(actor);
    sendResponse(res, 200, true, result.message, result);
  } catch (error) {
    next(error);
  }
};

export const updateSmtp = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const actor = getActorContext(req);
    const updated = await service.updateSmtpSettings(req.body, actor);
    sendResponse(res, 200, true, "SMTP settings updated successfully", updated);
  } catch (error) {
    next(error);
  }
};

export const testSmtp = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const actor = getActorContext(req);
    const result = await service.testSmtpConnection(actor);
    sendResponse(res, 200, true, result.message, result);
  } catch (error) {
    next(error);
  }
};

export const sendTestEmail = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const actor = getActorContext(req);
    const result = await service.sendTestEmail(req.body.recipientEmail, actor);
    sendResponse(res, 200, true, result.message, result);
  } catch (error) {
    next(error);
  }
};

export const handlePaymentWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const signature =
      (req.headers["x-signature"] as string) ||
      (req.headers["x-webhook-signature"] as string) ||
      (req.headers["stripe-signature"] as string);

    const eventType = (req.body?.event || req.body?.type || "payment.received") as string;
    const result = await service.handlePaymentWebhook(
      JSON.stringify(req.body),
      signature,
      eventType
    );

    sendResponse(res, 200, true, "Webhook event verified and processed successfully", result);
  } catch (error) {
    next(error);
  }
};
