import { Router } from "express";
import * as notificationController from "./notificationController.js";
import validate from "../../shared/middleware/validate.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requireRole from "../../shared/middleware/requireRole.js";
import { updateNotificationSettingsSchema } from "./notificationValidators.js";

const router = Router();

/**
 * @openapi
 * /api/v1/admin/notification-settings:
 *   get:
 *     tags: [Admin Notifications]
 *     summary: View email notification settings
 *     description: Every event is enabled by default until an administrator changes it. Password recovery emails are always sent and are not configurable.
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     responses:
 *       200: { description: Notification settings retrieved successfully }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  "/admin/notification-settings",
  authMiddleware,
  requireRole("admin"),
  notificationController.getSettings
);

/**
 * @openapi
 * /api/v1/admin/notification-settings:
 *   put:
 *     tags: [Admin Notifications]
 *     summary: Enable or disable email notifications per event
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [settings]
 *             properties:
 *               settings:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [event, enabled]
 *                   properties:
 *                     event:
 *                       type: string
 *                       enum: [BOOKING_CONFIRMATION, BOOKING_STATUS_CHANGE, PAYMENT_CONFIRMATION, OPERATIONAL_UPDATE]
 *                     enabled: { type: boolean }
 *     responses:
 *       200: { description: Notification settings updated successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.put(
  "/admin/notification-settings",
  authMiddleware,
  requireRole("admin"),
  validate(updateNotificationSettingsSchema),
  notificationController.updateSettings
);

export default router;