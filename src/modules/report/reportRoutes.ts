import { Router } from "express";
import * as reportController from "./reportController.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requireRole from "../../shared/middleware/requireRole.js";

const router = Router();

/**
 * @openapi
 * /api/v1/admin/reports/bookings:
 *   get:
 *     tags: [Admin Reports]
 *     summary: Booking volume by status
 *     description: Dates filter on the booking creation date.
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/ReportFromParam'
 *       - $ref: '#/components/parameters/ReportToParam'
 *       - $ref: '#/components/parameters/ReportBookingStatusParam'
 *       - $ref: '#/components/parameters/ReportServiceTypeParam'
 *       - $ref: '#/components/parameters/ReportAgentIdParam'
 *     responses:
 *       200: { description: Bookings report retrieved successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/admin/reports/bookings", authMiddleware, requireRole("admin"), reportController.adminBookingsReport);

/**
 * @openapi
 * /api/v1/admin/reports/revenue:
 *   get:
 *     tags: [Admin Reports]
 *     summary: Revenue, booked value, collected payments and outstanding balance
 *     description: "Revenue is the final price of completed bookings. Booked value covers confirmed, in-progress and completed bookings. Collected payments are verified payments. Outstanding balance is the unpaid value of confirmed-or-later bookings. Commissions are reported separately. The status filter is ignored."
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/ReportFromParam'
 *       - $ref: '#/components/parameters/ReportToParam'
 *       - $ref: '#/components/parameters/ReportServiceTypeParam'
 *       - $ref: '#/components/parameters/ReportAgentIdParam'
 *     responses:
 *       200: { description: Revenue report retrieved successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/admin/reports/revenue", authMiddleware, requireRole("admin"), reportController.adminRevenueReport);

/**
 * @openapi
 * /api/v1/admin/reports/payments:
 *   get:
 *     tags: [Admin Reports]
 *     summary: Payment status summary and reconciliation
 *     description: Reconciliation compares the value of paid bookings with verified payments. The status filter is ignored.
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/ReportFromParam'
 *       - $ref: '#/components/parameters/ReportToParam'
 *       - $ref: '#/components/parameters/ReportServiceTypeParam'
 *       - $ref: '#/components/parameters/ReportAgentIdParam'
 *     responses:
 *       200: { description: Payments report retrieved successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/admin/reports/payments", authMiddleware, requireRole("admin"), reportController.adminPaymentsReport);

/**
 * @openapi
 * /api/v1/admin/reports/services:
 *   get:
 *     tags: [Admin Reports]
 *     summary: Service-level booking performance
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/ReportFromParam'
 *       - $ref: '#/components/parameters/ReportToParam'
 *       - $ref: '#/components/parameters/ReportBookingStatusParam'
 *       - $ref: '#/components/parameters/ReportServiceTypeParam'
 *       - $ref: '#/components/parameters/ReportAgentIdParam'
 *     responses:
 *       200: { description: Services report retrieved successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/admin/reports/services", authMiddleware, requireRole("admin"), reportController.adminServicesReport);

/**
 * @openapi
 * /api/v1/admin/reports/agents:
 *   get:
 *     tags: [Admin Reports]
 *     summary: Agent activity and performance
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/ReportFromParam'
 *       - $ref: '#/components/parameters/ReportToParam'
 *       - $ref: '#/components/parameters/ReportBookingStatusParam'
 *       - $ref: '#/components/parameters/ReportServiceTypeParam'
 *       - $ref: '#/components/parameters/ReportAgentIdParam'
 *     responses:
 *       200: { description: Agents report retrieved successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/admin/reports/agents", authMiddleware, requireRole("admin"), reportController.adminAgentsReport);

/**
 * @openapi
 * /api/v1/admin/reports/commissions:
 *   get:
 *     tags: [Admin Reports]
 *     summary: Platform-wide commission summary
 *     description: Totals count active commissions only. The status filter is ignored.
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/ReportFromParam'
 *       - $ref: '#/components/parameters/ReportToParam'
 *       - $ref: '#/components/parameters/ReportServiceTypeParam'
 *       - $ref: '#/components/parameters/ReportAgentIdParam'
 *     responses:
 *       200: { description: Commissions report retrieved successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/admin/reports/commissions", authMiddleware, requireRole("admin"), reportController.adminCommissionsReport);

/**
 * @openapi
 * /api/v1/agent/reports/bookings:
 *   get:
 *     tags: [Agent Reports]
 *     summary: Own booking performance
 *     description: Aggregates over the agent's own bookings only. No customer information is returned.
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/ReportFromParam'
 *       - $ref: '#/components/parameters/ReportToParam'
 *       - $ref: '#/components/parameters/ReportBookingStatusParam'
 *       - $ref: '#/components/parameters/ReportServiceTypeParam'
 *     responses:
 *       200: { description: Bookings report retrieved successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/agent/reports/bookings", authMiddleware, requireRole("agent"), reportController.agentBookingsReport);

/**
 * @openapi
 * /api/v1/agent/reports/revenue:
 *   get:
 *     tags: [Agent Reports]
 *     summary: Financial summary for own bookings
 *     description: Same revenue definitions as the admin report, limited to the agent's own bookings. The status filter is ignored.
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/ReportFromParam'
 *       - $ref: '#/components/parameters/ReportToParam'
 *       - $ref: '#/components/parameters/ReportServiceTypeParam'
 *     responses:
 *       200: { description: Revenue report retrieved successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/agent/reports/revenue", authMiddleware, requireRole("agent"), reportController.agentRevenueReport);

/**
 * @openapi
 * /api/v1/agent/reports/commissions:
 *   get:
 *     tags: [Agent Reports]
 *     summary: Own commission summary
 *     security: [{ bearerAuth: [] }, { cookieAuth: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/ReportFromParam'
 *       - $ref: '#/components/parameters/ReportToParam'
 *       - $ref: '#/components/parameters/ReportServiceTypeParam'
 *     responses:
 *       200: { description: Commissions report retrieved successfully }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/agent/reports/commissions", authMiddleware, requireRole("agent"), reportController.agentCommissionsReport);

export default router;