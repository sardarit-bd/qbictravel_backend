import { Router } from "express";
import * as commissionController from "./commissionController.js";
import validate from "../../shared/middleware/validate.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requireRole from "../../shared/middleware/requireRole.js";
import {
  adjustCommissionSchema,
  commissionIdParamSchema,
  configureCommissionRuleSchema,
  createCommissionPolicySchema,
  policyIdParamSchema,
  updateCommissionPolicySchema,
} from "./commissionValidators.js";

const router = Router();

/**
 * @openapi
 * /api/v1/agent/commissions:
 *   get:
 *     tags: [Agent Commissions]
 *     summary: View own commission records
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 */
router.get("/agent/commissions", authMiddleware, requireRole("agent"), commissionController.listAgentCommissions);

/**
 * @openapi
 * /api/v1/agent/commissions/{commissionId}:
 *   get:
 *     tags: [Agent Commissions]
 *     summary: View an own commission record
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
 */
router.get("/admin/commissions", authMiddleware, requireRole("admin"), commissionController.listAdminCommissions);

/**
 * @openapi
 * /api/v1/admin/commissions/{commissionId}:
 *   get:
 *     tags: [Admin Commissions]
 *     summary: Review a commission record with its adjustment history
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
 * Commission Policies & Rules Management
 */

router.get("/admin/commission-rules", authMiddleware, requireRole("admin"), commissionController.getRules);

router.post(
  "/admin/commission-rules",
  authMiddleware,
  requireRole("admin"),
  validate(createCommissionPolicySchema),
  commissionController.createDraftPolicy
);

router.put(
  "/admin/commission-rules",
  authMiddleware,
  requireRole("admin"),
  validate(configureCommissionRuleSchema),
  commissionController.configureRule
);

router.post(
  "/admin/commission-rules/disable",
  authMiddleware,
  requireRole("admin"),
  commissionController.disableCommission
);

router.get(
  "/admin/commission-rules/:policyId",
  authMiddleware,
  requireRole("admin"),
  validate(policyIdParamSchema, "params"),
  commissionController.getPolicyById
);

router.patch(
  "/admin/commission-rules/:policyId",
  authMiddleware,
  requireRole("admin"),
  validate(policyIdParamSchema, "params"),
  validate(updateCommissionPolicySchema),
  commissionController.updatePolicy
);

router.post(
  "/admin/commission-rules/:policyId/publish",
  authMiddleware,
  requireRole("admin"),
  validate(policyIdParamSchema, "params"),
  commissionController.publishPolicy
);

router.post(
  "/admin/commission-rules/:policyId/deactivate",
  authMiddleware,
  requireRole("admin"),
  validate(policyIdParamSchema, "params"),
  commissionController.deactivatePolicy
);

router.post(
  "/admin/commission-rules/:policyId/archive",
  authMiddleware,
  requireRole("admin"),
  validate(policyIdParamSchema, "params"),
  commissionController.archivePolicy
);

router.delete(
  "/admin/commission-rules/:policyId",
  authMiddleware,
  requireRole("admin"),
  validate(policyIdParamSchema, "params"),
  commissionController.deletePolicy
);

router.post(
  "/admin/commission-rules/:policyId/revision",
  authMiddleware,
  requireRole("admin"),
  validate(policyIdParamSchema, "params"),
  commissionController.createRevision
);

export default router;
