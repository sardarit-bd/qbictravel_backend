import { Router } from "express";
import * as customerController from "./customerController.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requireRole from "../../shared/middleware/requireRole.js";
import validate from "../../shared/middleware/validate.js";
import { bookingIdParamSchema } from "./customerValidators.js";

const router = Router();

// Protect all customer routes with auth and the customer role.
router.use(authMiddleware);
router.use(requireRole("customer"));

/**
 * @openapi
 * /api/v1/customer/bookings:
 *   get:
 *     tags: [Customer Portal]
 *     summary: Retrieve paginated bookings owned by the authenticated customer
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - { name: status, in: query, schema: { type: string } }
 *       - { name: search, in: query, schema: { type: string } }
 *     responses:
 *       200: { description: Customer bookings retrieved successfully }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/customer/bookings", customerController.listBookings);

/**
 * @openapi
 * /api/v1/customer/bookings/{bookingId}:
 *   get:
 *     tags: [Customer Portal]
 *     summary: Retrieve a single booking owned by the authenticated customer
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: bookingId, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Customer booking retrieved successfully }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  "/customer/bookings/:bookingId",
  validate(bookingIdParamSchema, "params"),
  customerController.getBooking
);

export default router;
