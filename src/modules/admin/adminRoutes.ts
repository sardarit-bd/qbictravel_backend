import { Router } from "express";

import * as adminController from "./adminController.js";
import validate from "../../shared/middleware/validate.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requireRole from "../../shared/middleware/requireRole.js";
import {
  agentIdParamSchema,
  createAgentSchema,
  createStaffSchema,
  listAgentsQuerySchema,
  listUsersQuerySchema,
  staffIdParamSchema,
  updateAgentSchema,
  updateStaffSchema,
  updateUserSchema,
  userIdParamSchema,
} from "./adminValidators.js";

const router = Router();

router.use(authMiddleware, requireRole("admin"));

/**
 * @openapi
 * /api/v1/admin/users:
 *   get:
 *     tags:
 *       - Admin Users
 *     summary: List and search users
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SearchParam'
 *       - $ref: '#/components/parameters/StatusParam'
 *       - name: role
 *         in: query
 *         schema:
 *           type: string
 *           enum: [customer, agent, staff, admin]
 *     responses:
 *       200:
 *         description: Users retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminUserListResponse'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get("/users", validate(listUsersQuerySchema, "query"), adminController.listUsers);

/**
 * @openapi
 * /api/v1/admin/users/{userId}:
 *   get:
 *     tags:
 *       - Admin Users
 *     summary: View a user
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: userId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: User retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminUserResponse'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get("/users/:userId", validate(userIdParamSchema, "params"), adminController.getUser);

/**
 * @openapi
 * /api/v1/admin/users/{userId}:
 *   patch:
 *     tags:
 *       - Admin Users
 *     summary: Update permitted account details or status
 *     description: Name, phone and status only. Role cannot be changed, and an admin cannot change their own status.
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: userId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AdminUpdateUserRequest'
 *     responses:
 *       200:
 *         description: User updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminUserResponse'
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
  "/users/:userId",
  validate(userIdParamSchema, "params"),
  validate(updateUserSchema),
  adminController.updateUser,
);

/**
 * @openapi
 * /api/v1/admin/agents:
 *   post:
 *     tags:
 *       - Admin Agents
 *     summary: Create an agent account
 *     description: Creates the agent and emails a set-password link.
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AdminCreateAgentRequest'
 *     responses:
 *       201:
 *         description: Agent created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminUserResponse'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       409:
 *         $ref: '#/components/responses/Conflict'
 */
router.post("/agents", validate(createAgentSchema), adminController.createAgent);

/**
 * @openapi
 * /api/v1/admin/agents:
 *   get:
 *     tags:
 *       - Admin Agents
 *     summary: List agents
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SearchParam'
 *       - $ref: '#/components/parameters/StatusParam'
 *     responses:
 *       200:
 *         description: Agents retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminUserListResponse'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get("/agents", validate(listAgentsQuerySchema, "query"), adminController.listAgents);

/**
 * @openapi
 * /api/v1/admin/agents/{agentId}:
 *   get:
 *     tags:
 *       - Admin Agents
 *     summary: View agent details
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: agentId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Agent retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminUserResponse'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get("/agents/:agentId", validate(agentIdParamSchema, "params"), adminController.getAgent);

/**
 * @openapi
 * /api/v1/admin/agents/{agentId}:
 *   patch:
 *     tags:
 *       - Admin Agents
 *     summary: Update agent details, status, or permitted settings
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - name: agentId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AdminUpdateAgentRequest'
 *     responses:
 *       200:
 *         description: Agent updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminUserResponse'
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
  "/agents/:agentId",
  validate(agentIdParamSchema, "params"),
  validate(updateAgentSchema),
  adminController.updateAgent,
);

/**
 * @openapi
 * /api/v1/admin/staff:
 *   get:
 *     tags:
 *       - Admin Staff
 *     summary: View staff accounts
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SearchParam'
 *       - $ref: '#/components/parameters/StatusParam'
 *     responses:
 *       200:
 *         description: Staff retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminUserListResponse'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get("/staff", validate(listAgentsQuerySchema, "query"), adminController.listStaff);

/**
 * @openapi
 * /api/v1/admin/staff:
 *   post:
 *     tags:
 *       - Admin Staff
 *     summary: Create a staff account
 *     description: Creates the staff account and emails a set-password link.
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AdminCreateStaffRequest'
 *     responses:
 *       201:
 *         description: Staff account created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminUserResponse'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       409:
 *         $ref:
 *     $ref: '#/components/responses/Conflict'

*/
router.post("/staff", validate(createStaffSchema), adminController.createStaff);

/**

@openapi
/api/v1/admin/staff/{staffId}:
patch:
tags:
  - Admin Staff
summary: Update staff access or account status
description: Name, phone and status only. A deactivated staff account is blocked from protected operations immediately.
security:
  - bearerAuth: []
  - cookieAuth: []
parameters:
  - name: staffId
    in: path
    required: true
    schema:
      type: string
      format: uuid
requestBody:
  required: true
  content:
    application/json:
      schema:
        $ref: '#/components/schemas/AdminUpdateUserRequest'
responses:
  200:
    description: Staff account updated successfully
    content:
      application/json:
        schema:
          $ref: '#/components/schemas/AdminUserResponse'
  400:
    $ref: '#/components/responses/ValidationError'
  401:
    $ref: '#/components/responses/Unauthorized'
  403:
    $ref: '#/components/responses/Forbidden'
  404:
    $ref: '#/components/responses/NotFound'

*/
router.patch('/staff/:staffId',
validate(staffIdParamSchema, "params"),
validate(updateStaffSchema),
adminController.updateStaff,
);

export default router;