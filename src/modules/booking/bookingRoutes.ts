import { Router } from "express";
import * as bookingController from "./bookingController.js";
import validate from "../../shared/middleware/validate.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requireRole from "../../shared/middleware/requireRole.js";
import requirePermission from "../../shared/middleware/requirePermission.js";
import { guestCheckoutRateLimiter, guestAccessRateLimiter } from "../../shared/middleware/rateLimiter.js";
import {
  createBookingSchema,
  createStaffBookingSchema,
  createGuestBookingSchema,
  guestAccessTokenParamSchema,
  updateBookingPriceSchema,
  reviewBookingPriceSchema,
  reviewPendingBookingSchema,
  listPendingReservationsQuerySchema,
  bookingIdParamSchema,
  listStaffCustomersQuerySchema,
  listStaffCreatedBookingsQuerySchema,
  amendStaffBookingSchema,
  cancelStaffBookingSchema,
  listAllActivityHistoryQuerySchema,
} from "./bookingValidators.js";

const router = Router();

/**
 * @openapi
 * /api/v1/bookings/guest:
 *   post:
 *     tags:
 *       - Guest Bookings
 *     summary: Create an anonymous guest booking
 *     description: Public visitors can reserve a tour as a guest without creating an account. Generates an immutable guest snapshot, secure access token, and active payment link.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customer, serviceId]
 *             properties:
 *               customer:
 *                 type: object
 *                 required: [name, email]
 *                 properties:
 *                   name: { type: string }
 *                   email: { type: string, format: email }
 *                   phone: { type: string, nullable: true }
 *               serviceId: { type: string, format: uuid }
 *               travelDate: { type: string }
 *               adults: { type: integer, minimum: 1 }
 *               children: { type: integer, minimum: 0 }
 *               infants: { type: integer, minimum: 0 }
 *               notes: { type: string }
 *               referralCode: { type: string }
 *     responses:
 *       201:
 *         description: Guest booking created successfully
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       409:
 *         $ref: '#/components/responses/Conflict'
 */
router.post(
  "/bookings/guest",
  guestCheckoutRateLimiter,
  validate(createGuestBookingSchema),
  bookingController.createGuestBooking
);

/**
 * @openapi
 * /api/v1/public/bookings/access/{token}:
 *   get:
 *     tags:
 *       - Guest Bookings
 *     summary: Retrieve guest booking itinerary using a secure magic link token
 *     description: Returns sanitized, read-only itinerary details for anonymous guests without requiring an account or exposing internal customer records.
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: 64-character hex guest access token
 *     responses:
 *       200:
 *         description: Guest booking details retrieved successfully
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       403:
 *         description: Token revoked
 *       404:
 *         description: Invalid or unknown token
 *       410:
 *         description: Token expired
 */
router.get(
  "/public/bookings/access/:token",
  guestAccessRateLimiter,
  validate(guestAccessTokenParamSchema, "params"),
  bookingController.getPublicGuestBookingAccess
);

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
  requireRole("customer", "affiliate"),
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

router.get(
  "/agent/bookings/:bookingId/history",
  authMiddleware,
  requireRole("agent"),
  validate(bookingIdParamSchema, "params"),
  bookingController.getAgentBookingHistory
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

/**
 * @openapi
 * /api/v1/staff/bookings:
 *   post:
 *     tags:
 *       - Staff Bookings
 *     summary: Create a booking for a customer as staff
 *     description: Staff members can create bookings for existing customers or new guest customers at standard tour prices.
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [serviceId]
 *             properties:
 *               customerId: { type: string, format: uuid }
 *               customer:
 *                 type: object
 *                 required: [name, email]
 *                 properties:
 *                   name: { type: string }
 *                   email: { type: string, format: email }
 *                   phone: { type: string, nullable: true }
 *               serviceId: { type: string, format: uuid }
 *               travelDate: { type: string }
 *               adults: { type: integer, minimum: 1 }
 *               children: { type: integer, minimum: 0 }
 *               infants: { type: integer, minimum: 0 }
 *               notes: { type: string }
 *     responses:
 *       201:
 *         description: Booking created successfully
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post(
  "/staff/bookings",
  authMiddleware,
  requirePermission("bookings.create"),
  validate(createStaffBookingSchema),
  bookingController.createStaffBooking
);

router.get(
  "/staff/customers",
  authMiddleware,
  requirePermission("bookings.create"),
  validate(listStaffCustomersQuerySchema, "query"),
  bookingController.listStaffCustomers
);

/**
 * @openapi
 * /api/v1/staff/created-bookings:
 *   get:
 *     tags:
 *       - Staff Bookings
 *     summary: List bookings created by the authenticated staff user
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 */
router.get(
  "/staff/created-bookings",
  authMiddleware,
  requireRole("staff", "admin"),
  validate(listStaffCreatedBookingsQuerySchema, "query"),
  bookingController.listStaffCreatedBookings
);

/**
 * @openapi
 * /api/v1/staff/bookings/{bookingId}:
 *   patch:
 *     tags:
 *       - Staff Bookings
 *     summary: Amend an existing booking
 *     description: Staff and Admin can update customer details, travel dates, passenger counts, pickup location, notes, and price/discount.
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 */
router.patch(
  "/staff/bookings/:bookingId",
  authMiddleware,
  requirePermission("bookings.create"),
  validate(bookingIdParamSchema, "params"),
  validate(amendStaffBookingSchema),
  bookingController.amendStaffBooking
);

/**
 * @openapi
 * /api/v1/staff/bookings/{bookingId}/cancel:
 *   post:
 *     tags:
 *       - Staff Bookings
 *     summary: Cancel a booking
 *     description: Staff and Admin can cancel a booking, releasing reserved seats.
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 */
router.post(
  "/staff/bookings/:bookingId/cancel",
  authMiddleware,
  requirePermission("bookings.update_status"),
  validate(bookingIdParamSchema, "params"),
  validate(cancelStaffBookingSchema),
  bookingController.cancelStaffBooking
);

/**
 * @openapi
 * /api/v1/admin/activity-history:
 *   get:
 *     tags:
 *       - Admin Bookings
 *     summary: Global activity and audit history across all bookings and staff actions
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 */
router.get(
  "/admin/activity-history",
  authMiddleware,
  requirePermission("bookings.view"),
  validate(listAllActivityHistoryQuerySchema, "query"),
  bookingController.getAdminActivityHistory
);


export default router;
