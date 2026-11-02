import { Router } from "express";
import * as commissionController from "./commissionController.js";
import validate from "../../shared/middleware/validate.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requireRole from "../../shared/middleware/requireRole.js";
import {
  adjustCommissionSchema,
  commissionIdParamSchema,
  configureCommissionRuleSchema,
} from "./commissionValidators.js";

const router = Router();

/**
 * @openapi
 * /api/v1/agent/commissions:
 *   get:
 *     tags: [Agent Commissions]
 *     summary: View own commission records
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - { name: status, in: query, schema: { type: string, enum: [ACTIVE, CANCELLED] } }
 *     responses:
 *       200: { description: Commissions retrieved successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/agent/commissions", authMiddleware, requireRole("agent"), commissionController.listAgentCommissions);

/**
 * @openapi
 * /api/v1/agent/commissions/{commissionId}:
 *   get:
 *     tags: [Agent Commissions]
 *     summary: View an own commission record
 *     description: Adjustment history shows amounts and dates only, not the administrator's reason.
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: commissionId, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Commission retrieved successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  "/agent/commissions/:commissionId",
  authMiddleware,
  requireRole("agent"),
  validate(commissionIdParamSchema, "params"),
  commissionController.getAgentCommission
);

/**
 * @openapi
 * /api/v1/admin/commissions:
 *   get:
 *     tags: [Admin Commissions]
 *     summary: View all agent commission records
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - { name: status, in: query, schema: { type: string, enum: [ACTIVE, CANCELLED] } }
 *       - { name: agentId, in: query, schema: { type: string, format: uuid } }
 *       - { name: bookingId, in: query, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Commissions retrieved successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/admin/commissions", authMiddleware, requireRole("admin"), commissionController.listAdminCommissions);

/**
 * @openapi
 * /api/v1/admin/commissions/{commissionId}:
 *   get:
 *     tags: [Admin Commissions]
 *     summary: Review a commission record with its adjustment history
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: commissionId, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Commission retrieved successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  "/admin/commissions/:commissionId",
  authMiddleware,
  requireRole("admin"),
  validate(commissionIdParamSchema, "params"),
  commissionController.getAdminCommission
);

/**
 * @openapi
 * /api/v1/admin/commissions/{commissionId}:
 *   patch:
 *     tags: [Admin Commissions]
 *     summary: Adjust the amount of an active commission
 *     description: The new amount must be between 0 and the booking amount. A reason is required and every adjustment is stored in an audit record and the booking history.
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - { name: commissionId, in: path, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, reason]
 *             properties:
 *               amount: { type: number, example: 40 }
 *               reason: { type: string, example: "Agreed reduction after customer discount" }
 *     responses:
 *       200: { description: Commission adjusted successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { description: Commission is not active, the amount is unchanged, or it was changed concurrently }
 */
router.patch(
  "/admin/commissions/:commissionId",
  authMiddleware,
  requireRole("admin"),
  validate(commissionIdParamSchema, "params"),
  validate(adjustCommissionSchema),
  commissionController.adjustCommission
);

/**
 * @openapi
 * /api/v1/admin/commission-rules:
 *   get:
 *     tags: [Admin Commissions]
 *     summary: View the active commission policy and its history
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200: { description: Commission rules retrieved successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/admin/commission-rules", authMiddleware, requireRole("admin"), commissionController.getRules);

/**
 * @openapi
 * /api/v1/admin/commission-rules:
 *   put:
 *     tags: [Admin Commissions]
 *     summary: Configure the commission policy
 *     description: Creates a new active rule and deactivates the previous one. Existing commissions keep the rule they were calculated with. Applies to payments verified after the change.
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rateType, rateValue]
 *             properties:
 *               rateType: { type: string, enum: [PERCENTAGE, FIXED] }
 *               rateValue: { type: number, example: 10 }
 *     responses:
 *       200: { description: Commission rule updated successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409: { description: The rule could not be updated because of a concurrent change }
 */
router.put(
  "/admin/commission-rules",
  authMiddleware,
  requireRole("admin"),
  validate(configureCommissionRuleSchema),
  commissionController.configureRule
);

export default router;