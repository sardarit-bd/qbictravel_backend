import { Router } from "express";
import * as paymentController from "./paymentController.js";
import validate from "../../shared/middleware/validate.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requireRole from "../../shared/middleware/requireRole.js";
import requirePermission from "../../shared/middleware/requirePermission.js";
import {
  createOmiseChargeSchema,
  createPaymentSchema,
  createStripeSessionSchema,
  generatePaymentLinkSchema,
  paymentBookingIdParamSchema,
  paymentIdParamSchema,
  publicInitiatePaymentSchema,
  publicOmiseVerifySchema,
  publicPayPalCaptureSchema,
  publicPaymentTokenParamSchema,
  recordPaymentSchema,
  verifyPaymentSchema,
} from "./paymentValidators.js";

const router = Router();

/**
 * @openapi
 * /api/v1/bookings/{bookingId}/payments:
 *   post:
 *     tags: [Customer Payments]
 *     summary: Initiate a payment or submit a receipt for an own booking
 *     description: The amount is set by the server from the booking price. A submitted receipt is not verified payment.
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: bookingId, in: path, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [method]
 *             properties:
 *               method: { type: string, enum: [BANK_TRANSFER, CASH, OTHER, STRIPE] }
 *               reference: { type: string, description: "Transaction or receipt reference. Makes the payment SUBMITTED." }
 *               receiptNote: { type: string }
 *     responses:
 *       201: { description: Payment created }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { description: Booking cannot accept a payment, or an active payment or the reference already exists }
 */
router.post(
  "/bookings/:bookingId/payments",
  authMiddleware,
  requireRole("customer", "affiliate"),
  validate(paymentBookingIdParamSchema, "params"),
  validate(createPaymentSchema),
  paymentController.createPayment
);

/**
 * @openapi
 * /api/v1/bookings/{bookingId}/stripe-session:
 *   post:
 *     tags: [Customer Payments]
 *     summary: Create or retrieve a Stripe Checkout Session for a booking
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: bookingId, in: path, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               successUrl: { type: string, format: uri }
 *               cancelUrl: { type: string, format: uri }
 *     responses:
 *       200: { description: Stripe checkout session initialized }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { description: Booking not payable or already paid }
 */
router.post(
  "/bookings/:bookingId/stripe-session",
  authMiddleware,
  requireRole("customer", "affiliate"),
  validate(paymentBookingIdParamSchema, "params"),
  validate(createStripeSessionSchema),
  paymentController.createStripeSession
);

/**
 * @openapi
 * /api/v1/bookings/{bookingId}/omise-charge:
 *   post:
 *     tags: [Customer Payments]
 *     summary: Create an Omise card charge for an owned booking
 *     description: Creates an Omise card charge using a single-use card token. Returns authorizeUri for 3DS or verified status for immediate non-3DS charges.
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: bookingId, in: path, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string, description: "Omise single-use card token starting with tokn_" }
 *               returnUrl: { type: string, format: uri, description: "Custom 3DS return URL" }
 *     responses:
 *       200: { description: Omise charge created or verified }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       403: { description: Forbidden if not owner }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { description: Booking already paid or not payable }
 */
router.post(
  "/bookings/:bookingId/omise-charge",
  authMiddleware,
  requireRole("customer", "affiliate"),
  validate(paymentBookingIdParamSchema, "params"),
  validate(createOmiseChargeSchema),
  paymentController.createCustomerOmiseCharge
);


/**
 * @openapi
 * /api/v1/payments/{paymentId}/reconcile:
 *   post:
 *     tags: [Admin Payments]
 *     summary: Reconcile a Stripe payment record against Stripe authoritative state
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: paymentId, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Payment reconciled }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  "/payments/:paymentId/reconcile",
  authMiddleware,
  requirePermission("payments.verify"),
  validate(paymentIdParamSchema, "params"),
  paymentController.reconcilePayment
);

/**
 * @openapi
 * /api/v1/payments/{paymentId}/omise-verify:
 *   post:
 *     tags: [Customer Payments]
 *     summary: Verify Omise charge status upon customer return from 3DS authorization
 *     description: Authoritatively retrieves charge status from Omise and settles payment atomically.
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: paymentId, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Payment status retrieved or settled }
 *       400: { description: Invalid payment method or missing Omise charge }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  "/payments/:paymentId/omise-verify",
  authMiddleware,
  requireRole("customer", "affiliate", "admin", "agent"),
  validate(paymentIdParamSchema, "params"),
  paymentController.verifyOmisePayment
);


/**
 * @openapi
 * /api/v1/customer/payments:
 *   get:
 *     tags: [Customer Payments]
 *     summary: View own payment records
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: page, in: query, schema: { type: integer } }
 *       - { name: limit, in: query, schema: { type: integer } }
 *       - { name: status, in: query, schema: { type: string, enum: [INITIATED, SUBMITTED, VERIFIED, REJECTED] } }
 *     responses:
 *       200: { description: Payments retrieved successfully }
 */
router.get(
  "/customer/payments",
  authMiddleware,
  requireRole("customer", "affiliate"),
  paymentController.listCustomerPayments
);

/**
 * @openapi
 * /api/v1/customer/payments/{paymentId}:
 *   get:
 *     tags: [Customer Payments]
 *     summary: View own payment details
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: paymentId, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Payment retrieved successfully }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  "/customer/payments/:paymentId",
  authMiddleware,
  requireRole("customer", "affiliate"),
  validate(paymentIdParamSchema, "params"),
  paymentController.getCustomerPayment
);

/**
 * @openapi
 * /api/v1/customer/payments/{paymentId}/reconcile:
 *   post:
 *     tags: [Customer Payments]
 *     summary: Customer returns from Stripe Checkout to verify and reconcile own payment status
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: paymentId, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Payment reconciled }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  "/customer/payments/:paymentId/reconcile",
  authMiddleware,
  requireRole("customer", "affiliate"),
  validate(paymentIdParamSchema, "params"),
  paymentController.reconcilePayment
);

/**
 * @openapi
 * /api/v1/agent/payments:
 *   get:
 *     tags: [Agent Payments]
 *     summary: View payments for the agent's own bookings
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: page, in: query, schema: { type: integer } }
 *       - { name: limit, in: query, schema: { type: integer } }
 *       - { name: status, in: query, schema: { type: string } }
 *     responses:
 *       200: { description: Payments retrieved successfully }
 */
router.get(
  "/agent/payments",
  authMiddleware,
  requireRole("agent"),
  paymentController.listAgentPayments
);

router.post(
  "/agent/bookings/:bookingId/payments",
  authMiddleware,
  requireRole("agent"),
  validate(paymentBookingIdParamSchema, "params"),
  validate(createPaymentSchema),
  paymentController.createAgentPayment
);

/**
 * @openapi
 * /api/v1/agent/bookings/{bookingId}/payment-link:
 *   post:
 *     tags: [Agent Payments]
 *     summary: Generate a secure customer payment link for an agent-created booking
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 */
router.post(
  "/agent/bookings/:bookingId/payment-link",
  authMiddleware,
  requireRole("agent"),
  validate(paymentBookingIdParamSchema, "params"),
  validate(generatePaymentLinkSchema),
  paymentController.generateAgentPaymentLink
);

/**
 * @openapi
 * /api/v1/staff/bookings/{bookingId}/payment-link:
 *   post:
 *     tags: [Staff Payments]
 *     summary: Generate a secure customer payment link for a staff-created or staff-assigned booking
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - name: bookingId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               expiresInDays: { type: integer, minimum: 1, maximum: 30, default: 7 }
 *     responses:
 *       200:
 *         description: Customer payment link generated successfully
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       409:
 *         description: Booking not eligible for payment link (paid, cancelled, or awaiting approval)
 */
router.post(
  "/staff/bookings/:bookingId/payment-link",
  authMiddleware,
  requirePermission("bookings.create"),
  validate(paymentBookingIdParamSchema, "params"),
  validate(generatePaymentLinkSchema),
  paymentController.generateStaffPaymentLink
);

/**
 * @openapi
 * /api/v1/public/payment-links/{token}:
 *   get:
 *     tags: [Public Payments]
 *     summary: View booking summary and payment status from a public customer payment link
 */
router.get(
  "/public/payment-links/:token",
  validate(publicPaymentTokenParamSchema, "params"),
  paymentController.getPublicPaymentLinkDetails
);

/**
 * @openapi
 * /api/v1/public/payment-links/{token}/stripe-session:
 *   post:
 *     tags: [Public Payments]
 *     summary: Initiate Stripe Checkout from a public customer payment link
 */
router.post(
  "/public/payment-links/:token/stripe-session",
  validate(publicPaymentTokenParamSchema, "params"),
  paymentController.createPublicStripeSession
);

/**
 * @openapi
 * /api/v1/public/payment-links/{token}/paypal-order:
 *   post:
 *     tags: [Public Payments]
 *     summary: Initiate PayPal order from a public customer payment link
 */
router.post(
  "/public/payment-links/:token/paypal-order",
  validate(publicPaymentTokenParamSchema, "params"),
  paymentController.createPublicPayPalOrder
);

/**
 * @openapi
 * /api/v1/public/payment-links/{token}/paypal-capture:
 *   post:
 *     tags: [Public Payments]
 *     summary: Capture PayPal order from a public customer payment link
 */
router.post(
  "/public/payment-links/:token/paypal-capture",
  validate(publicPaymentTokenParamSchema, "params"),
  validate(publicPayPalCaptureSchema),
  paymentController.capturePublicPayPalOrder
);

/**
 * @openapi
 * /api/v1/public/payment-links/{token}/omise-charge:
 *   post:
 *     tags: [Public Payments]
 *     summary: Initiate Omise card payment from a public customer payment link
 *     parameters:
 *       - { name: token, in: path, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string, description: "Omise single-use card token starting with tokn_" }
 *               returnUrl: { type: string, format: uri, description: "Custom 3DS return URL" }
 *     responses:
 *       200: { description: Omise charge created or verified }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { description: Booking already paid or payment link inactive }
 */
router.post(
  "/public/payment-links/:token/omise-charge",
  validate(publicPaymentTokenParamSchema, "params"),
  validate(createOmiseChargeSchema),
  paymentController.createPublicOmiseCharge
);

/**
 * @openapi
 * /api/v1/public/payment-links/{token}/omise-verify:
 *   post:
 *     tags: [Public Payments]
 *     summary: Verify Omise charge return for a public customer payment link
 *     parameters:
 *       - { name: token, in: path, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [paymentId]
 *             properties:
 *               paymentId: { type: string, format: uuid, description: "Payment ID created for the Omise charge" }
 *     responses:
 *       200: { description: Omise charge verified and settled }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post(
  "/public/payment-links/:token/omise-verify",
  validate(publicPaymentTokenParamSchema, "params"),
  validate(publicOmiseVerifySchema),
  paymentController.verifyPublicOmisePayment
);


router.post(
  "/agent/bookings/:bookingId/stripe-session",
  authMiddleware,
  requireRole("agent"),
  validate(paymentBookingIdParamSchema, "params"),
  validate(createStripeSessionSchema),
  paymentController.createAgentStripeSession
);

router.post(
  "/agent/payments/:paymentId/reconcile",
  authMiddleware,
  requireRole("agent"),
  validate(paymentIdParamSchema, "params"),
  paymentController.reconcilePayment
);

/**
 * @openapi
 * /api/v1/admin/payments:
 *   get:
 *     tags: [Admin Payments]
 *     summary: View and filter platform payments
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: page, in: query, schema: { type: integer } }
 *       - { name: limit, in: query, schema: { type: integer } }
 *       - { name: status, in: query, schema: { type: string } }
 *       - { name: method, in: query, schema: { type: string } }
 *       - { name: bookingId, in: query, schema: { type: string, format: uuid } }
 *       - { name: customerId, in: query, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Payments retrieved successfully }
 */
router.get(
  "/admin/payments",
  authMiddleware,
  requirePermission("payments.view"),
  paymentController.listAdminPayments
);

/**
 * @openapi
 * /api/v1/admin/payments/{paymentId}:
 *   get:
 *     tags: [Admin Payments]
 *     summary: View payment details
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: paymentId, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Payment retrieved successfully }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  "/admin/payments/:paymentId",
  authMiddleware,
  requirePermission("payments.view"),
  validate(paymentIdParamSchema, "params"),
  paymentController.getAdminPayment
);

/**
 * @openapi
 * /api/v1/admin/payments/{paymentId}/verify:
 *   post:
 *     tags: [Admin Payments]
 *     summary: Verify or reject a submitted manual payment
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: paymentId, in: path, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [decision]
 *             properties:
 *               decision: { type: string, enum: [VERIFIED, REJECTED] }
 *               notes: { type: string, description: "Required when rejecting" }
 *     responses:
 *       200: { description: Decision recorded }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { description: Payment is not awaiting verification }
 */
router.post(
  "/admin/payments/:paymentId/verify",
  authMiddleware,
  requirePermission("payments.verify"),
  validate(paymentIdParamSchema, "params"),
  validate(verifyPaymentSchema),
  paymentController.verifyPayment
);

/**
 * @openapi
 * /api/v1/admin/payments/{paymentId}/record:
 *   post:
 *     tags: [Admin Payments]
 *     summary: Record a payment received outside an automatic gateway
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: paymentId, in: path, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reference: { type: string }
 *               receivedAt: { type: string, format: date-time }
 *               notes: { type: string }
 *     responses:
 *       200: { description: Payment recorded }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { description: Payment is not in the initiated state }
 */
router.post(
  "/admin/payments/:paymentId/record",
  authMiddleware,
  requirePermission("payments.record"),
  validate(paymentIdParamSchema, "params"),
  validate(recordPaymentSchema),
  paymentController.recordPayment
);

export default router;
