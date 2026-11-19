import { Router } from "express";
import * as discountController from "./discountController.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requirePermission from "../../shared/middleware/requirePermission.js";
import validate from "../../shared/middleware/validate.js";
import {
  createStaffDiscountRequestSchema,
  reviewStaffDiscountRequestSchema,
  listStaffDiscountRequestsQuerySchema,
  discountRequestIdParamSchema,
  bookingIdParamSchema,
} from "./discountValidators.js";

const router = Router();

router.post(
  "/staff/bookings/:bookingId/discount-requests",
  authMiddleware,
  requirePermission("bookings.create"),
  validate(bookingIdParamSchema, "params"),
  validate(createStaffDiscountRequestSchema),
  discountController.createStaffDiscountRequest
);

/**
 * @openapi
 * /api/v1/admin/discounts:
 *   get:
 *     tags:
 *       - Admin Discount Management
 *     summary: List discount requests
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 */
router.get(
  "/admin/discounts",
  authMiddleware,
  requirePermission("bookings.approve_price"),
  validate(listStaffDiscountRequestsQuerySchema, "query"),
  discountController.listStaffDiscountRequests
);

/**
 * @openapi
 * /api/v1/admin/discounts/summary:
 *   get:
 *     tags:
 *       - Admin Discount Management
 *     summary: Aggregate summary and staff statistics for discount requests
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 */
router.get(
  "/admin/discounts/summary",
  authMiddleware,
  requirePermission("bookings.approve_price"),
  discountController.getStaffDiscountSummary
);

/**
 * @openapi
 * /api/v1/admin/discounts/{requestId}/review:
 *   post:
 *     tags:
 *       - Admin Discount Management
 *     summary: Approve, partially approve, or reject a staff discount request
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 */
router.post(
  "/admin/discounts/:requestId/review",
  authMiddleware,
  requirePermission("bookings.approve_price"),
  validate(discountRequestIdParamSchema, "params"),
  validate(reviewStaffDiscountRequestSchema),
  discountController.reviewStaffDiscountRequest
);

export default router;
