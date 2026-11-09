import { Router } from "express";
import * as agentController from "./agentController.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requireRole from "../../shared/middleware/requireRole.js";
import validate from "../../shared/middleware/validate.js";
import {
  bookingIdParamSchema,
  createAgentCustomerSchema,
  updateAgentProfileSchema,
} from "./agentValidators.js";

const router = Router();

// Protect all agent routes with auth and agent role
router.use(authMiddleware);
router.use(requireRole("agent"));

/**
 * @openapi
 * /api/v1/agent/overview:
 *   get:
 *     tags: [Agent Portal]
 *     summary: Retrieve real dashboard overview metrics for authenticated agent
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     responses:
 *       200: { description: Agent overview metrics retrieved successfully }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/overview", agentController.getOverview);

/**
 * @openapi
 * /api/v1/agent/bookings:
 *   get:
 *     tags: [Agent Portal]
 *     summary: Retrieve paginated bookings created by the authenticated agent
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - { name: status, in: query, schema: { type: string } }
 *       - { name: search, in: query, schema: { type: string } }
 *     responses:
 *       200: { description: Agent bookings retrieved successfully }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/bookings", agentController.listBookings);

/**
 * @openapi
 * /api/v1/agent/bookings/{bookingId}:
 *   get:
 *     tags: [Agent Portal]
 *     summary: Retrieve a single booking belonging to the authenticated agent
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: bookingId, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Agent booking retrieved successfully }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  "/bookings/:bookingId",
  validate(bookingIdParamSchema, "params"),
  agentController.getBooking
);

/**
 * @openapi
 * /api/v1/agent/profile:
 *   get:
 *     tags: [Agent Portal]
 *     summary: Retrieve agency profile for authenticated agent
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     responses:
 *       200: { description: Agent profile retrieved successfully }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/profile", agentController.getProfile);

/**
 * @openapi
 * /api/v1/agent/profile:
 *   patch:
 *     tags: [Agent Portal]
 *     summary: Update agency name and contact details
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               agencyName: { type: string, example: "Phuket Sun Travel Co." }
 *               name: { type: string, example: "John Agent" }
 *               phone: { type: string, example: "+66 81 234 5678" }
 *     responses:
 *       200: { description: Agent profile updated successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.patch(
  "/profile",
  validate(updateAgentProfileSchema),
  agentController.updateProfile
);

router.get("/customers", agentController.listCustomers);

router.post(
  "/customers",
  validate(createAgentCustomerSchema),
  agentController.createCustomer
);

export default router;
