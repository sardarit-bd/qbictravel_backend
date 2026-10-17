import { Router } from "express";
import * as pricingController from "./pricingController.js";
import validate from "../../shared/middleware/validate.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requireRole from "../../shared/middleware/requireRole.js";
import {
  createPricingRuleSchema,
  updatePricingRuleSchema,
  pricingRuleIdParamSchema,
} from "./pricingValidators.js";

const router = Router();

/**
 * @openapi
 * /api/v1/admin/pricing-rules:
 *   get:
 *     tags:
 *       - Admin Pricing
 *     summary: List all pricing rules
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Pricing rules retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Pricing rules retrieved successfully" }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       name: { type: string }
 *                       type: { type: string, enum: [AGENT_DISCOUNT_LIMIT] }
 *                       value: { type: number }
 *                       isActive: { type: boolean }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  "/admin/pricing-rules",
  authMiddleware,
  requireRole("admin"),
  pricingController.listPricingRules
);

/**
 * @openapi
 * /api/v1/admin/pricing-rules:
 *   post:
 *     tags:
 *       - Admin Pricing
 *     summary: Create a new pricing rule
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, type, value]
 *             properties:
 *               name: { type: string, example: "Global 10% Discount Limit" }
 *               description: { type: string, nullable: true }
 *               type: { type: string, enum: [AGENT_DISCOUNT_LIMIT], example: "AGENT_DISCOUNT_LIMIT" }
 *               value: { type: number, example: 10 }
 *               agentId: { type: string, format: uuid, nullable: true }
 *               serviceId: { type: string, format: uuid, nullable: true }
 *               isActive: { type: boolean, example: true }
 *     responses:
 *       201:
 *         description: Pricing rule created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Pricing rule created successfully" }
 *                 data: { type: object }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post(
  "/admin/pricing-rules",
  authMiddleware,
  requireRole("admin"),
  validate(createPricingRuleSchema),
  pricingController.createPricingRule
);

/**
 * @openapi
 * /api/v1/admin/pricing-rules/{ruleId}:
 *   patch:
 *     tags:
 *       - Admin Pricing
 *     summary: Update an existing pricing rule
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: ruleId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string, nullable: true }
 *               value: { type: number }
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Pricing rule updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Pricing rule updated successfully" }
 *                 data: { type: object }
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
  "/admin/pricing-rules/:ruleId",
  authMiddleware,
  requireRole("admin"),
  validate(pricingRuleIdParamSchema, "params"),
  validate(updatePricingRuleSchema),
  pricingController.updatePricingRule
);

/**
 * @openapi
 * /api/v1/agent/pricing-limits:
 *   get:
 *     tags:
 *       - Agent Pricing
 *     summary: View the agent's permitted pricing limits
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: serviceId
 *         in: query
 *         required: false
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Agent pricing limits retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Agent pricing limits retrieved successfully" }
 *                 data:
 *                   type: object
 *                   properties:
 *                     maxDiscountPercentage: { type: number, example: 15 }
 *                     applicableRuleId: { type: string, format: uuid, nullable: true }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get(
  "/agent/pricing-limits",
  authMiddleware,
  requireRole("agent"),
  pricingController.getAgentPricingLimits
);

export default router;