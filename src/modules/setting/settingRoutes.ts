import { Router } from "express";
import * as controller from "./settingController.js";
import validate from "../../shared/middleware/validate.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requirePermission from "../../shared/middleware/requirePermission.js";
import {
  updateGeneralSettingsSchema,
  updatePaymentSettingsSchema,
  updateWebhookSettingsSchema,
  updateCloudinarySettingsSchema,
  updateSmtpSettingsSchema,
  sendTestEmailSchema,
  listAuditLogsQuerySchema,
} from "./settingValidators.js";

const router = Router();

/**
 * @openapi
 * /api/v1/admin/settings:
 *   get:
 *     tags: [Admin Settings]
 *     summary: Retrieve comprehensive system settings overview
 *     description: Returns current configurations with all secret credentials masked (e.g. ••••••••1234).
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     responses:
 *       200: { description: Settings retrieved successfully }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  "/admin/settings",
  authMiddleware,
  requirePermission([
    "settings.view",
    "settings.general.manage",
    "settings.payment.manage",
    "settings.webhook.manage",
    "settings.cloudinary.manage",
    "settings.smtp.manage",
  ]),
  controller.getOverview
);

/**
 * @openapi
 * /api/v1/admin/settings/general:
 *   put:
 *     tags: [Admin Settings]
 *     summary: Update platform general settings
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               platformName: { type: string }
 *               supportEmail: { type: string, format: email }
 *               supportPhone: { type: string }
 *               defaultCurrency: { type: string }
 *               timezone: { type: string }
 *               defaultLanguage: { type: string }
 *               maintenanceMode: { type: boolean }
 *     responses:
 *       200: { description: General settings updated successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.put(
  "/admin/settings/general",
  authMiddleware,
  requirePermission("settings.general.manage"),
  validate(updateGeneralSettingsSchema),
  controller.updateGeneral
);

/**
 * @openapi
 * /api/v1/admin/settings/payment:
 *   put:
 *     tags: [Admin Settings]
 *     summary: Update payment gateway credentials and operating environment
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               providerName: { type: string }
 *               enabled: { type: boolean }
 *               environment: { type: string, enum: [sandbox, live] }
 *               publishableKey: { type: string }
 *               secretKey: { type: string, description: "Plaintext secret to encrypt. Never returned by server." }
 *               merchantId: { type: string }
 *               confirmLiveMode: { type: boolean, description: "Required true when switching to live environment." }
 *     responses:
 *       200: { description: Payment settings updated successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.put(
  "/admin/settings/payment",
  authMiddleware,
  requirePermission("settings.payment.manage"),
  validate(updatePaymentSettingsSchema),
  controller.updatePayment
);

/**
 * @openapi
 * /api/v1/admin/settings/webhook:
 *   put:
 *     tags: [Admin Settings]
 *     summary: Update webhook signing secret and enabled state
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               signingSecret: { type: string }
 *               enabled: { type: boolean }
 *     responses:
 *       200: { description: Webhook settings updated successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.put(
  "/admin/settings/webhook",
  authMiddleware,
  requirePermission("settings.webhook.manage"),
  validate(updateWebhookSettingsSchema),
  controller.updateWebhook
);

/**
 * @openapi
 * /api/v1/admin/settings/cloudinary:
 *   put:
 *     tags: [Admin Settings]
 *     summary: Update Cloudinary media credentials and storage preferences
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               cloudName: { type: string }
 *               apiKey: { type: string }
 *               apiSecret: { type: string, description: "Plaintext secret to encrypt. Never returned by server." }
 *               folder: { type: string }
 *               maxFileSizeBytes: { type: number }
 *               allowedFormats: { type: array, items: { type: string } }
 *     responses:
 *       200: { description: Cloudinary settings updated successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.put(
  "/admin/settings/cloudinary",
  authMiddleware,
  requirePermission("settings.cloudinary.manage"),
  validate(updateCloudinarySettingsSchema),
  controller.updateCloudinary
);

/**
 * @openapi
 * /api/v1/admin/settings/cloudinary/test:
 *   post:
 *     tags: [Admin Settings]
 *     summary: Verify live connection to Cloudinary API
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     responses:
 *       200: { description: Cloudinary connection verified successfully }
 *       502: { description: Cloudinary connection failed }
 */
router.post(
  "/admin/settings/cloudinary/test",
  authMiddleware,
  requirePermission("settings.cloudinary.manage"),
  controller.testCloudinary
);

/**
 * @openapi
 * /api/v1/admin/settings/smtp:
 *   put:
 *     tags: [Admin Settings]
 *     summary: Update SMTP outbound email server credentials
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               host: { type: string }
 *               port: { type: number }
 *               secure: { type: boolean }
 *               user: { type: string }
 *               pass: { type: string, description: "Plaintext password to encrypt. Never returned by server." }
 *               fromEmail: { type: string, format: email }
 *               fromName: { type: string }
 *               enabled: { type: boolean }
 *     responses:
 *       200: { description: SMTP settings updated successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.put(
  "/admin/settings/smtp",
  authMiddleware,
  requirePermission("settings.smtp.manage"),
  validate(updateSmtpSettingsSchema),
  controller.updateSmtp
);

/**
 * @openapi
 * /api/v1/admin/settings/smtp/test:
 *   post:
 *     tags: [Admin Settings]
 *     summary: Test connection and handshake with configured SMTP host
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     responses:
 *       200: { description: SMTP connection verified successfully }
 *       502: { description: SMTP verification failed }
 */
router.post(
  "/admin/settings/smtp/test",
  authMiddleware,
  requirePermission("settings.smtp.manage"),
  controller.testSmtp
);

/**
 * @openapi
 * /api/v1/admin/settings/smtp/send-test:
 *   post:
 *     tags: [Admin Settings]
 *     summary: Send an actual test email through configured SMTP
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recipientEmail]
 *             properties:
 *               recipientEmail: { type: string, format: email }
 *     responses:
 *       200: { description: Test email delivered successfully }
 *       502: { description: Test email dispatch failed }
 */
router.post(
  "/admin/settings/smtp/send-test",
  authMiddleware,
  requirePermission("settings.smtp.manage"),
  validate(sendTestEmailSchema),
  controller.sendTestEmail
);

/**
 * @openapi
 * /api/v1/admin/settings/audit-logs:
 *   get:
 *     tags: [Admin Settings]
 *     summary: View configuration audit log trail
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: category, in: query, schema: { type: string } }
 *       - { name: status, in: query, schema: { type: string } }
 *       - { name: page, in: query, schema: { type: integer, default: 1 } }
 *       - { name: limit, in: query, schema: { type: integer, default: 20 } }
 *     responses:
 *       200: { description: Audit logs retrieved successfully }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  "/admin/settings/audit-logs",
  authMiddleware,
  requirePermission(["settings.audit.view", "settings.view"]),
  validate(listAuditLogsQuerySchema, "query"),
  controller.getAuditLogs
);

/**
 * @openapi
 * /api/v1/webhooks/payment:
 *   post:
 *     tags: [Webhooks]
 *     summary: Inbound payment webhook receiver
 *     description: Cryptographically verifies HMAC SHA-256 signature against configured webhook signing secret.
 *     responses:
 *       200: { description: Webhook processed successfully }
 *       401: { description: Missing or invalid webhook signature }
 */
router.post(
  "/webhooks/payment",
  controller.handlePaymentWebhook
);

export default router;
