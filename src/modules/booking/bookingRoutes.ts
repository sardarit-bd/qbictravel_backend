import { Router } from "express";
import * as bookingController from "./bookingController.js";
import validate from "../../shared/middleware/validate.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requireRole from "../../shared/middleware/requireRole.js";
import {
  createBookingSchema,
  updateBookingPriceSchema,
  reviewBookingPriceSchema,
  bookingIdParamSchema,
} from "./bookingValidators.js";

const router = Router();

/**
 * @openapi
 * /api/v1/bookings:
 *   post:
 *     tags:
 *       - Customer Bookings
 *     summary: Create a direct booking
 *     description: Customers can create bookings at the base price. They cannot negotiate or submit a proposed price.
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerId, serviceId]
 *             properties:
 *               customerId: { type: string, format: uuid }
 *               serviceId: { type: string, format: uuid }
 *               availabilityId: { type: string, format: uuid, nullable: true }
 *     responses:
 *       201:
 *         description: Booking created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Booking created successfully" }
 *                 data: { type: object }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post(
  "/bookings",
  authMiddleware,
  requireRole("customer"),
  validate(createBookingSchema),
  bookingController.createBooking
);

/**
 * @openapi
 * /api/v1/agent/bookings:
 *   post:
 *     tags:
 *       - Agent Bookings
 *     summary: Create a booking for an authorized customer
 *     description: Agents can propose a price. If the price is within their permitted discount limits, it is auto-confirmed. Otherwise, it requires admin approval.
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customerId, serviceId, proposedPrice]
 *             properties:
 *               customerId: { type: string, format: uuid }
 *               serviceId: { type: string, format: uuid }
 *               availabilityId: { type: string, format: uuid, nullable: true }
 *               proposedPrice: { type: number, example: 90 }
 *     responses:
 *       201:
 *         description: Booking created and confirmed successfully
 *       202:
 *         description: Booking created, awaiting admin price approval
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post(
  "/agent/bookings",
  authMiddleware,
  requireRole("agent"),
  validate(createBookingSchema),
  bookingController.createBooking
);

/**
 * @openapi
 * /api/v1/agent/bookings/{bookingId}/price:
 *   patch:
 *     tags:
 *       - Agent Bookings
 *     summary: Submit or update a negotiated price
 *     description: Agents can update the proposed price. Price changes after booking confirmation are not allowed.
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: bookingId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [proposedPrice]
 *             properties:
 *               proposedPrice: { type: number, example: 85 }
 *     responses:
 *       200:
 *         description: Booking price updated successfully
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.patch(
  "/agent/bookings/:bookingId/price",
  authMiddleware,
  requireRole("agent"),
  validate(bookingIdParamSchema, "params"),
  validate(updateBookingPriceSchema),
  bookingController.updateBookingPrice
);

/**
 * @openapi
 * /api/v1/admin/bookings/{bookingId}/price-approvals:
 *   post:
 *     tags:
 *       - Admin Bookings
 *     summary: Review a price requiring administrative approval
 *     description: Admins can approve or reject a proposed price. Approving updates the final price and confirms the booking. Rejecting cancels the booking.
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: bookingId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [APPROVED, REJECTED], example: "APPROVED" }
 *               approvedPrice: { type: number, example: 85 }
 *               notes: { type: string, example: "Approved for VIP customer" }
 *     responses:
 *       200:
 *         description: Booking price reviewed successfully
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.post(
  "/admin/bookings/:bookingId/price-approvals",
  authMiddleware,
  requireRole("admin"),
  validate(bookingIdParamSchema, "params"),
  validate(reviewBookingPriceSchema),
  bookingController.reviewBookingPrice
);

export default router;