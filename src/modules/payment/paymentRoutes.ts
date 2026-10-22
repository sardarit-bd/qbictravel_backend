import { Router } from "express";
import * as paymentController from "./paymentController.js";
import validate from "../../shared/middleware/validate.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requireRole from "../../shared/middleware/requireRole.js";
import {
  createPaymentSchema,
  paymentBookingIdParamSchema,
  paymentIdParamSchema,
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
 *               method: { type: string, enum: [BANK_TRANSFER, CASH, OTHER] }
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
  requireRole("customer"),
  validate(paymentBookingIdParamSchema, "params"),
  validate(createPaymentSchema),
  paymentController.createPayment
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
  requireRole("customer"),
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
  requireRole("customer"),
  validate(paymentIdParamSchema, "params"),
  paymentController.getCustomerPayment
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
  requireRole("admin"),
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
  requireRole("admin"),
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
  requireRole("admin"),
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
  requireRole("admin"),
  validate(paymentIdParamSchema, "params"),
  validate(recordPaymentSchema),
  paymentController.recordPayment
);

export default router;