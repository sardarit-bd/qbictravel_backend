import { Router } from "express";

import * as userController from "./userController.js";
import validate from "../../shared/middleware/validate.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requireRole from "../../shared/middleware/requireRole.js";
import {
  updateProfileSchema,
  updateEmailSchema,
  confirmAvatarSchema,
} from "./userValidators.js";

const router = Router();

router.use(authMiddleware);

/**
 * @openapi
 * /api/v1/users/me:
 *   get:
 *     tags:
 *       - Users
 *     summary: Retrieve own profile
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get("/me", userController.getMe);

/**
 * @openapi
 * /api/v1/users/me:
 *   patch:
 *     tags:
 *       - Users
 *     summary: Update permitted profile fields
 *     description: Only name and phone can be changed here.
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Profile updated successfully
 */
router.patch("/me", validate(updateProfileSchema), userController.updateMe);

/**
 * @openapi
 * /api/v1/users/me/email:
 *   put:
 *     tags:
 *       - Users
 *     summary: Update own email address with password verification (Admin only)
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Email updated successfully
 *       400:
 *         description: Validation error or same email
 *       401:
 *         description: Incorrect password / Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions (Admin only)
 *       409:
 *         description: Email already in use
 */
router.put(
  "/me/email",
  requireRole("admin"),
  validate(updateEmailSchema),
  userController.updateEmail,
);

/**
 * @openapi
 * /api/v1/users/me/avatar/signature:
 *   post:
 *     tags:
 *       - Users
 *     summary: Request Cloudinary upload signature for profile picture
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Upload signature generated
 */
router.post(
  "/me/avatar/signature",
  userController.createAvatarSignature,
);

/**
 * @openapi
 * /api/v1/users/me/avatar/confirm:
 *   post:
 *     tags:
 *       - Users
 *     summary: Confirm uploaded profile picture and update user avatar
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Avatar confirmed and updated
 */
router.post(
  "/me/avatar/confirm",
  validate(confirmAvatarSchema),
  userController.confirmAvatar,
);

/**
 * @openapi
 * /api/v1/users/me/avatar:
 *   delete:
 *     tags:
 *       - Users
 *     summary: Remove own profile picture and clean up managed storage asset
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Avatar removed successfully
 */
router.delete(
  "/me/avatar",
  userController.removeAvatar,
);

export default router;
