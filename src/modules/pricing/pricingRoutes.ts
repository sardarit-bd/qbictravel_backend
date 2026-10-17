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

// Admin Routes
router.get(
  "/admin/pricing-rules",
  authMiddleware,
  requireRole("admin"),
  pricingController.listPricingRules
);

router.post(
  "/admin/pricing-rules",
  authMiddleware,
  requireRole("admin"),
  validate(createPricingRuleSchema),
  pricingController.createPricingRule
);

router.patch(
  "/admin/pricing-rules/:ruleId",
  authMiddleware,
  requireRole("admin"),
  validate(pricingRuleIdParamSchema, "params"),
  validate(updatePricingRuleSchema),
  pricingController.updatePricingRule
);

// Agent Routes
router.get(
  "/agent/pricing-limits",
  authMiddleware,
  requireRole("agent"),
  pricingController.getAgentPricingLimits
);

export default router;