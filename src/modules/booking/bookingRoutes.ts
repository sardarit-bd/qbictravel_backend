import { Router } from "express";
import * as bookingController from "./bookingController.js";
import validate from "../../shared/middleware/validate.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requireRole from "../../shared/middleware/requireRole.js";
import requirePermission from "../../shared/middleware/requirePermission.js";
import {
  createBookingSchema,
  updateBookingPriceSchema,
  reviewBookingPriceSchema,
  reviewPendingBookingSchema,
  listPendingReservationsQuerySchema,
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
  requirePermission("bookings.approve_price"),
  validate(bookingIdParamSchema, "params"),
  validate(reviewBookingPriceSchema),
  bookingController.reviewBookingPrice
);

/**
 * @openapi
 * /api/v1/admin/bookings/pending:
 *   get:
 *     tags:
 *       - Admin Bookings
 *     summary: List pending reservations requiring confirmation or review
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: paymentStatus
 *         schema: { type: string, enum: [UNPAID, PARTIALLY_PAID, PAID] }
 *     responses:
 *       200:
 *         description: List of pending reservations
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  "/admin/bookings/pending",
  authMiddleware,
  requirePermission("bookings.view"),
  validate(listPendingReservationsQuerySchema, "query"),
  bookingController.listPendingReservations
);

/**
 * @openapi
 * /api/v1/admin/bookings/pending/{bookingId}:
 *   get:
 *     tags:
 *       - Admin Bookings
 *     summary: Get details of a single pending reservation
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: bookingId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Pending reservation details
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  "/admin/bookings/pending/:bookingId",
  authMiddleware,
  requirePermission("bookings.view"),
  validate(bookingIdParamSchema, "params"),
  bookingController.getPendingReservation
);

/**
 * @openapi
 * /api/v1/admin/bookings/pending/{bookingId}/review:
 *   post:
 *     tags:
 *       - Admin Bookings
 *     summary: Confirm or reject a pending customer reservation
 *     description: Admins can confirm an eligible pending reservation (promoting it to CONFIRMED so it enters the operational queue) or reject/cancel it.
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
 *             required: [action]
 *             properties:
 *               action: { type: string, enum: [CONFIRM, REJECT], example: "CONFIRM" }
 *               notes: { type: string, example: "Verified traveler identity and availability" }
 *     responses:
 *       200:
 *         description: Booking confirmation or rejection processed
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
  "/admin/bookings/pending/:bookingId/review",
  authMiddleware,
  requirePermission("bookings.update_status"),
  validate(bookingIdParamSchema, "params"),
  validate(reviewPendingBookingSchema),
  bookingController.reviewPendingReservation
);

/**
 * @openapi
 * /api/v1/admin/bookings/{bookingId}/history:
 *   get:
 *     tags:
 *       - Admin Bookings
 *     summary: Retrieve chronological activity history for a booking
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: bookingId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100 }
 *     responses:
 *       200:
 *         description: Booking activity history retrieved successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  "/admin/bookings/:bookingId/history",
  authMiddleware,
  requirePermission("bookings.view"),
  validate(bookingIdParamSchema, "params"),
  bookingController.getAdminBookingHistory
);

/**
 * @openapi
 * /api/v1/staff/operations/bookings/{bookingId}/history:
 *   get:
 *     tags:
 *       - Staff Operations
 *     summary: Retrieve chronological activity history for an assigned booking
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: bookingId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100 }
 *     responses:
 *       200:
 *         description: Booking activity history retrieved successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  "/staff/operations/bookings/:bookingId/history",
  authMiddleware,
  requireRole("staff"),
  validate(bookingIdParamSchema, "params"),
  bookingController.getStaffBookingHistory
);

export default router;
