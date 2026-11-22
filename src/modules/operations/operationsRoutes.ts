import { Router } from "express";
import * as operationsController from "./operationsController.js";
import validate from "../../shared/middleware/validate.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requireRole from "../../shared/middleware/requireRole.js";
import requirePermission from "../../shared/middleware/requirePermission.js";
import {
  adminUpdateOperationalStatusSchema,
  assignBookingSchema,
  operationsBookingIdParamSchema,
  updateOperationalStatusSchema,
  operationsScheduleQuerySchema,
} from "./operationsValidators.js";

const router = Router();

/**
 * @openapi
 * /api/v1/operations/schedule:
 *   get:
 *     tags: [Operations Schedule]
 *     summary: View daily/weekly operational tour schedule and manifest
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 */
router.get(
  "/operations/schedule",
  authMiddleware,
  requirePermission("bookings.view"),
  validate(operationsScheduleQuerySchema, "query"),
  operationsController.getOperationsSchedule
);

/**
 * @openapi
 * /api/v1/staff/operations/bookings:
 *   get:
 *     tags: [Staff Operations]
 *     summary: View the operational queue of bookings assigned to the staff member
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: page, in: query, schema: { type: integer } }
 *       - { name: limit, in: query, schema: { type: integer } }
 *       - { name: fulfillmentStatus, in: query, schema: { type: string, enum: [NOT_STARTED, IN_PROGRESS, FULFILLED] } }
 *     responses:
 *       200: { description: Operational bookings retrieved successfully }
 */
router.get(
  "/staff/operations/bookings",
  authMiddleware,
  requireRole("staff"),
  operationsController.listStaffBookings
);

/**
 * @openapi
 * /api/v1/staff/operations/bookings/{bookingId}:
 *   get:
 *     tags: [Staff Operations]
 *     summary: Review fulfillment details of an assigned booking
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: bookingId, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Operational booking retrieved successfully }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  "/staff/operations/bookings/:bookingId",
  authMiddleware,
  requireRole("staff"),
  validate(operationsBookingIdParamSchema, "params"),
  operationsController.getStaffBooking
);

/**
 * @openapi
 * /api/v1/staff/operations/bookings/{bookingId}/status:
 *   patch:
 *     tags: [Staff Operations]
 *     summary: Update the fulfillment status of an assigned booking
 *     description: Allowed forward steps are NOT_STARTED to IN_PROGRESS and IN_PROGRESS to FULFILLED. Completion requires verified payment.
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: bookingId, in: path, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fulfillmentStatus]
 *             properties:
 *               fulfillmentStatus: { type: string, enum: [NOT_STARTED, IN_PROGRESS, FULFILLED] }
 *               notes: { type: string }
 *     responses:
 *       200: { description: Fulfillment status updated successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { description: Transition not allowed for the current booking state }
 */
router.patch(
  "/staff/operations/bookings/:bookingId/status",
  authMiddleware,
  requireRole("staff"),
  validate(operationsBookingIdParamSchema, "params"),
  validate(updateOperationalStatusSchema),
  operationsController.updateStaffBookingStatus
);

/**
 * @openapi
 * /api/v1/admin/operations/bookings:
 *   get:
 *     tags: [Admin Operations]
 *     summary: Review all operational bookings
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: page, in: query, schema: { type: integer } }
 *       - { name: limit, in: query, schema: { type: integer } }
 *       - { name: fulfillmentStatus, in: query, schema: { type: string, enum: [NOT_STARTED, IN_PROGRESS, FULFILLED] } }
 *       - { name: assignedStaffId, in: query, schema: { type: string, format: uuid } }
 *       - { name: agentId, in: query, schema: { type: string, format: uuid } }
 *       - { name: createdById, in: query, schema: { type: string, format: uuid } }
 *       - { name: source, in: query, schema: { type: string, enum: [DIRECT, AGENT, ADMIN, CUSTOMER] } }
 *     responses:
 *       200: { description: Operational bookings retrieved successfully }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  "/admin/operations/bookings",
  authMiddleware,
  requireRole("admin"),
  requirePermission("bookings.view"),
  operationsController.listAdminBookings
);

/**
 * @openapi
 * /api/v1/admin/operations/bookings/{bookingId}/assignment:
 *   patch:
 *     tags: [Admin Operations]
 *     summary: Assign or unassign operational ownership of a booking
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: bookingId, in: path, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [staffId]
 *             properties:
 *               staffId: { type: string, format: uuid, nullable: true }
 *               notes: { type: string }
 *     responses:
 *       200: { description: Booking assigned successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { description: Closed bookings cannot be reassigned }
 */
router.patch(
  "/admin/operations/bookings/:bookingId/assignment",
  authMiddleware,
  requireRole("admin"),
  validate(operationsBookingIdParamSchema, "params"),
  validate(assignBookingSchema),
  operationsController.assignBooking
);

/**
 * @openapi
 * /api/v1/admin/operations/bookings/{bookingId}/status:
 *   patch:
 *     tags: [Admin Operations]
 *     summary: Update or correct the fulfillment status of any booking
 *     description: Admins may step backwards (IN_PROGRESS to NOT_STARTED, FULFILLED to IN_PROGRESS) to correct operational mistakes.
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: bookingId, in: path, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fulfillmentStatus, notes]
 *             properties:
 *               fulfillmentStatus: { type: string, enum: [NOT_STARTED, IN_PROGRESS, FULFILLED] }
 *               notes: { type: string }
 *     responses:
 *       200: { description: Fulfillment status corrected successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { description: Transition not allowed for the current booking state }
 */
router.patch(
  "/admin/operations/bookings/:bookingId/status",
  authMiddleware,
  requireRole("admin"),
  validate(operationsBookingIdParamSchema, "params"),
  validate(adminUpdateOperationalStatusSchema),
  operationsController.updateAdminBookingStatus
);

export default router;
