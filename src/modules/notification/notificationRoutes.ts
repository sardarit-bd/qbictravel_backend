import { Router } from "express";
import * as notificationController from "./notificationController.js";
import validate from "../../shared/middleware/validate.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requireRole from "../../shared/middleware/requireRole.js";
import {
  listNotificationsQuerySchema,
  updateNotificationSettingsSchema,
  updatePreferencesSchema,
} from "./notificationValidators.js";

const router = Router();

/**
 * User Notification Endpoints (Accessible to all authenticated roles)
 */

// GET /api/v1/notifications - List user's notifications (paginated, unread filter)
router.get(
  "/notifications",
  authMiddleware,
  validate(listNotificationsQuerySchema, "query"),
  notificationController.listNotifications,
);

// GET /api/v1/notifications/unread-count - Efficient unread count for badges
router.get(
  "/notifications/unread-count",
  authMiddleware,
  notificationController.getUnreadCount,
);

// PATCH /api/v1/notifications/read-all - Mark all user notifications as read
router.patch(
  "/notifications/read-all",
  authMiddleware,
  notificationController.markAllAsRead,
);

// PATCH /api/v1/notifications/:id/read - Mark single notification as read
router.patch(
  "/notifications/:id/read",
  authMiddleware,
  notificationController.markAsRead,
);

// GET /api/v1/notifications/preferences - Get notification preferences
router.get(
  "/notifications/preferences",
  authMiddleware,
  notificationController.getPreferences,
);

// PUT /api/v1/notifications/preferences - Update notification preferences
router.put(
  "/notifications/preferences",
  authMiddleware,
  validate(updatePreferencesSchema, "body"),
  notificationController.updatePreferences,
);

/**
 * Admin System Notification Settings
 */
router.get(
  "/admin/notification-settings",
  authMiddleware,
  requireRole("admin"),
  notificationController.getSettings,
);

router.put(
  "/admin/notification-settings",
  authMiddleware,
  requireRole("admin"),
  validate(updateNotificationSettingsSchema, "body"),
  notificationController.updateSettings,
);

export default router;
