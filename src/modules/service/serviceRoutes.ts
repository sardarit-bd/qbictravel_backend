import { Router } from "express";
import validate from "../../shared/middleware/validate.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requirePermission from "../../shared/middleware/requirePermission.js";

import * as serviceController from "./serviceController.js";
import {
  createServiceSchema,
  updateServiceSchema,
  updateServiceStatusSchema,
  availabilityUpdateSchema,
  pricingUpdateSchema,
  getAdminServicesQuerySchema,
  bulkUpdateServiceStatusSchema,
} from "./serviceValidators.js";

const router = Router();

// ==========================================
// Public Routes (/api/v1/services)
// ==========================================

/**
 * @openapi
 * /api/v1/services:
 *   get:
 *     tags:
 *       - Services (Public)
 *     summary: Browse published travel services
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [HOTEL, PACKAGE, TOUR]
 *     responses:
 *       200:
 *         description: List of published services
 */
router.get("/services", serviceController.getServices);

/**
 * @openapi
 * /api/v1/services/{serviceId}:
 *   get:
 *     tags:
 *       - Services (Public)
 *     summary: View a service's details
 *     parameters:
 *       - in: path
 *         name: serviceId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Service details
 *       404:
 *         description: Service not found or not published
 */
router.get("/services/:serviceId", serviceController.getService);

/**
 * @openapi
 * /api/v1/services/{serviceId}/availability:
 *   get:
 *     tags:
 *       - Services (Public)
 *     summary: Check bookable dates or availability information
 *     parameters:
 *       - in: path
 *         name: serviceId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Availability information
 *       404:
 *         description: Service not found or not published
 */
router.get("/services/:serviceId/availability", serviceController.getServiceAvailability);

/**
 * @openapi
 * /api/v1/services/{serviceId}/pricing:
 *   get:
 *     tags:
 *       - Services (Public)
 *     summary: Retrieve applicable customer-facing pricing
 *     parameters:
 *       - in: path
 *         name: serviceId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pricing information
 *       404:
 *         description: Service not found or not published
 */
router.get("/services/:serviceId/pricing", serviceController.getServicePricing);

// ==========================================
// Admin Routes (/api/v1/admin/services)
// ==========================================

/**
 * @openapi
 * /api/v1/admin/services:
 *   get:
 *     tags:
 *       - Services (Admin)
 *     summary: List all managed services, including unpublished entries
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all services
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/admin/services", authMiddleware, requirePermission("tours.view"), validate(getAdminServicesQuerySchema, "query"), serviceController.getAdminServices);

/**
 * @openapi
 * /api/v1/admin/services/bulk-status:
 *   patch:
 *     tags:
 *       - Services (Admin)
 *     summary: Bulk update status of multiple services
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - serviceIds
 *               - status
 *             properties:
 *               serviceIds:
 *                 type: array
 *                 items:
 *                   type: string
 *               status:
 *                 $ref: '#/components/schemas/ServiceStatus'
 *     responses:
 *       200:
 *         description: Status updated for matching services
 *       400:
 *         description: Validation error
 *       401/403:
 *         description: Unauthorized/Forbidden
 */
router.patch("/admin/services/bulk-status", authMiddleware, requirePermission("tours.edit"), validate(bulkUpdateServiceStatusSchema), serviceController.bulkUpdateServiceStatus);

/**
 * @openapi
 * /api/v1/admin/services:
 *   post:
 *     tags:
 *       - Services (Admin)
 *     summary: Create a hotel, package, or tour listing
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateServiceRequest'
 *     responses:
 *       201:
 *         description: Service created successfully
 *       400:
 *         description: Validation error
 *       401/403:
 *         description: Unauthorized/Forbidden
 */
router.post("/admin/services", authMiddleware, requirePermission("tours.create"), validate(createServiceSchema), serviceController.createService);

/**
 * @openapi
 * /api/v1/admin/services/{serviceId}:
 *   get:
 *     tags:
 *       - Services (Admin)
 *     summary: View a managed service
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: serviceId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Service details
 *       404:
 *         description: Service not found
 */
router.get("/admin/services/:serviceId", authMiddleware, requirePermission("tours.view"), serviceController.getAdminService);

/**
 * @openapi
 * /api/v1/admin/services/{serviceId}:
 *   patch:
 *     tags:
 *       - Services (Admin)
 *     summary: Update service details
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: serviceId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [HOTEL, PACKAGE, TOUR]
 *               providerName:
 *                 type: string
 *               providerId:
 *                 type: string
 *               metadata:
 *                 type: object
 *     responses:
 *       200:
 *         description: Service updated successfully
 */
router.patch("/admin/services/:serviceId", authMiddleware, requirePermission("tours.edit"), validate(updateServiceSchema), serviceController.updateService);

/**
 * @openapi
 * /api/v1/admin/services/{serviceId}/status:
 *   patch:
 *     tags:
 *       - Services (Admin)
 *     summary: Publish or unpublish a service
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: serviceId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateServiceStatusRequest'
 *     responses:
 *       200:
 *         description: Service status updated successfully
 */
router.patch("/admin/services/:serviceId/status", authMiddleware, requirePermission("tours.edit"), validate(updateServiceStatusSchema), serviceController.updateServiceStatus);

/**
 * @openapi
 * /api/v1/admin/availability:
 *   get:
 *     tags:
 *       - Services (Admin)
 *     summary: Review managed availability
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: serviceId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Availability overview
 */
router.get("/admin/availability", authMiddleware, requirePermission("tours.view"), serviceController.getAdminAvailability);

/**
 * @openapi
 * /api/v1/admin/services/{serviceId}/availability:
 *   put:
 *     tags:
 *       - Services (Admin)
 *     summary: Maintain availability manually
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: serviceId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AvailabilityUpdateRequest'
 *     responses:
 *       200:
 *         description: Availability updated successfully
 */
router.put("/admin/services/:serviceId/availability", authMiddleware, requirePermission("tours.edit"), validate(availabilityUpdateSchema), serviceController.updateAdminAvailability);

/**
 * @openapi
 * /api/v1/admin/services/{serviceId}/pricing:
 *   get:
 *     tags:
 *       - Services (Admin)
 *     summary: Review a service's pricing settings
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: serviceId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pricing settings
 */
router.get("/admin/services/:serviceId/pricing", authMiddleware, requirePermission("tours.view"), serviceController.getAdminPricing);

/**
 * @openapi
 * /api/v1/admin/services/{serviceId}/pricing:
 *   put:
 *     tags:
 *       - Services (Admin)
 *     summary: Maintain standard pricing
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: serviceId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PricingUpdateRequest'
 *     responses:
 *       200:
 *         description: Pricing updated successfully
 */
router.put("/admin/services/:serviceId/pricing", authMiddleware, requirePermission("tours.edit"), validate(pricingUpdateSchema), serviceController.updateAdminPricing);

export default router;