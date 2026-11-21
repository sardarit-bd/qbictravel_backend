import type { Request, Response, NextFunction } from "express";
import * as notificationService from "./notificationService.js";
import sendResponse from "../../shared/utils/response.js";
import type {
  NotificationPreferencesInput,
  NotificationQueryFilters,
  UpdateNotificationSettingsInput,
} from "./notificationTypes.js";

export const getSettings = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await notificationService.getSettings();
    sendResponse(res, 200, true, "Notification settings retrieved successfully", data);
  } catch (error) {
    next(error);
  }
};

export const updateSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const adminId = (req as any).user.id;
    const data = await notificationService.updateSettings(
      adminId,
      req.body as UpdateNotificationSettingsInput,
    );
    sendResponse(res, 200, true, "Notification settings updated successfully", data);
  } catch (error) {
    next(error);
  }
};

export const listNotifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const filters: NotificationQueryFilters = {
      page: req.query.page ? parseInt(String(req.query.page), 10) : 1,
      limit: req.query.limit ? parseInt(String(req.query.limit), 10) : 20,
      isRead: req.query.isRead !== undefined ? String(req.query.isRead) === "true" : undefined,
    };

    const result = await notificationService.getUserNotifications(userId, filters);
    sendResponse(res, 200, true, "Notifications retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

export const getUnreadCount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const result = await notificationService.getUnreadCount(userId);
    sendResponse(res, 200, true, "Unread notification count retrieved", result);
  } catch (error) {
    next(error);
  }
};

export const markAsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const notification = await notificationService.markAsRead(id, userId);

    if (!notification) {
      sendResponse(res, 404, false, "Notification not found or access denied", null);
      return;
    }

    sendResponse(res, 200, true, "Notification marked as read", notification);
  } catch (error) {
    next(error);
  }
};

export const markAllAsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const result = await notificationService.markAllAsRead(userId);
    sendResponse(res, 200, true, "All notifications marked as read", result);
  } catch (error) {
    next(error);
  }
};

export const getPreferences = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const preferences = await notificationService.getUserPreferences(userId);
    sendResponse(res, 200, true, "Notification preferences retrieved successfully", preferences);
  } catch (error) {
    next(error);
  }
};

export const updatePreferences = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const preferences = await notificationService.setUserPreferences(
      userId,
      req.body as NotificationPreferencesInput,
    );
    sendResponse(res, 200, true, "Notification preferences updated successfully", preferences);
  } catch (error) {
    next(error);
  }
};
