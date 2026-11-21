import { Router } from "express";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requirePermission from "../../shared/middleware/requirePermission.js";
import validate from "../../shared/middleware/validate.js";
import * as mediaController from "./mediaController.js";
import {
  confirmMediaSchema,
  createSignatureSchema,
  getMediaQuerySchema,
  mediaIdParamSchema,
  bulkDeleteMediaSchema,
  bulkAttachDetachSchema,
  syncAssetSchema,
} from "./mediaValidators.js";

const router = Router();

// Authenticate all media management routes
router.use(authMiddleware);

/**
 * @openapi
 * /api/v1/admin/media/signature:
 *   post:
 *     tags:
 *       - Admin Media
 *     summary: Generate signed Cloudinary upload parameters
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               folder:
 *                 type: string
 *                 example: phukettours/tours
 *               publicId:
 *                 type: string
 *                 example: tour_custom_id
 *               batchSize:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 10
 *                 default: 1
 *     responses:
 *       200:
 *         description: Signed upload parameters generated
 *       400:
 *         description: Invalid upload parameters
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - admin only
 *       503:
 *         description: Cloudinary service not configured
 */
router.post(
  "/signature",
  requirePermission("media.upload"),
  validate(createSignatureSchema, "body"),
  mediaController.createSignature,
);

/**
 * @openapi
 * /api/v1/admin/media/confirm:
 *   post:
 *     tags:
 *       - Admin Media
 *     summary: Verify uploaded asset with Cloudinary and persist database record
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - publicId
 *             properties:
 *               publicId:
 *                 type: string
 *                 example: phukettours/tours/sample_tour_1
 *               assetId:
 *                 type: string
 *                 example: 9a2f7c00e6c...
 *               serviceId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Media confirmed and created
 *       200:
 *         description: Duplicate upload idempotently returned
 *       400:
 *         description: Validation error, unapproved folder, or invalid format/size
 *       404:
 *         description: Asset not found in Cloudinary or associated service not found
 *       502:
 *         description: Cloudinary verification failure
 */
router.post(
  "/confirm",
  requirePermission("media.upload"),
  validate(confirmMediaSchema, "body"),
  mediaController.confirmAsset,
);

/**
 * @openapi
 * /api/v1/admin/media:
 *   get:
 *     tags:
 *       - Admin Media
 *     summary: List media records for Admin Media Manager
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: page
 *         in: query
 *         schema:
 *           type: integer
 *           default: 1
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           default: 20
 *       - name: serviceId
 *         in: query
 *         schema:
 *           type: string
 *           format: uuid
 *       - name: unattached
 *         in: query
 *         schema:
 *           type: string
 *           enum: [true, false]
 *       - name: search
 *         in: query
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated media list
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - admin only
 */
router.get(
  "/",
  requirePermission("media.view"),
  validate(getMediaQuerySchema, "query"),
  mediaController.listMedia,
);

/**
 * @openapi
 * /api/v1/admin/media/bulk-delete:
 *   post:
 *     tags:
 *       - Admin Media
 *     summary: Bulk delete media assets from Cloudinary and database
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mediaIds
 *             properties:
 *               mediaIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       200:
 *         description: Bulk deletion results with deleted and blocked lists
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post(
  "/bulk-delete",
  requirePermission("media.delete"),
  validate(bulkDeleteMediaSchema, "body"),
  mediaController.bulkDeleteMedia,
);

/**
 * @openapi
 * /api/v1/admin/media/bulk-attach:
 *   post:
 *     tags:
 *       - Admin Media
 *     summary: Bulk attach or detach media records to/from a service
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mediaIds
 *               - action
 *             properties:
 *               mediaIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *               action:
 *                 type: string
 *                 enum: [attach, detach]
 *               serviceId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Media assets updated successfully
 *       400:
 *         description: Validation error or missing serviceId
 */
router.post(
  "/bulk-attach",
  requirePermission("media.upload"),
  validate(bulkAttachDetachSchema, "body"),
  mediaController.bulkAttachDetachMedia,
);

/**
 * @openapi
 * /api/v1/admin/media/{mediaId}/sync:
 *   post:
 *     tags:
 *       - Admin Media
 *     summary: Synchronize media asset metadata from Cloudinary
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: mediaId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Asset synchronized
 *       404:
 *         description: Media not found
 *       502:
 *         description: Cloudinary connection error
 */
router.post(
  "/:mediaId/sync",
  requirePermission("media.upload"),
  validate(mediaIdParamSchema, "params"),
  mediaController.syncAsset,
);

/**
 * @openapi
 * /api/v1/admin/media/{mediaId}:
 *   get:
 *     tags:
 *       - Admin Media
 *     summary: Get single media asset details
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: mediaId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Media details retrieved
 *       404:
 *         description: Media record not found
 */
router.get(
  "/:mediaId",
  requirePermission("media.view"),
  validate(mediaIdParamSchema, "params"),
  mediaController.getMediaById,
);

/**
 * @openapi
 * /api/v1/admin/media/{mediaId}:
 *   delete:
 *     tags:
 *       - Admin Media
 *     summary: Delete a media asset from Cloudinary and database
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: mediaId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Media deleted successfully
 *       404:
 *         description: Media record not found
 *       409:
 *         description: Media is referenced by an active tour
 *       502:
 *         description: Cloudinary deletion failure
 */
router.delete(
  "/:mediaId",
  requirePermission("media.delete"),
  validate(mediaIdParamSchema, "params"),
  mediaController.deleteMedia,
);

export default router;
