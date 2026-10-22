import type { Request, Response, NextFunction } from "express";
import sendResponse from "../../shared/utils/response.js";
import * as notificationService from "./notificationService.js";

export const getSettings = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await notificationService.getSettings();
    sendResponse(res, 200, true, "Notification settings retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const updateSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await notificationService.updateSettings(req.user!.id, req.body);
    sendResponse(res, 200, true, "Notification settings updated successfully", result);
  } catch (error) {
    next(error);
  }
};