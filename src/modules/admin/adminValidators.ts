import * as yup from "yup";
import { emailField } from "../auth/authValidators.js";
import { phoneField } from "../user/userValidators.js";

/**
 * @openapi
 * components:
 *   schemas:
 *     AdminUpdateUserRequest:
 *       type: object
 *       minProperties: 1
 *       properties:
 *         name:
 *           type: string
 *         phone:
 *           type: string
 *           nullable: true
 *         status:
 *           type: string
 *           enum: [active, deactivated]
 *     AdminCreateAgentRequest:
 *       type: object
 *       required:
 *         - name
 *         - email
 *       properties:
 *         name:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         phone:
 *           type: string
 *         agencyName:
 *           type: string
 *     AdminUpdateAgentRequest:
 *       type: object
 *       minProperties: 1
 *       properties:
 *         name:
 *           type: string
 *         phone:
 *           type: string
 *           nullable: true
 *         status:
 *           type: string
 *           enum: [active, deactivated]
 *         agencyName:
 *           type: string
 *           nullable: true
 *     AdminCreateStaffRequest:
 *       type: object
 *       required:
 *         - name
 *         - email
 *       properties:
 *         name:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         phone:
 *           type: string
 */

const statusValues = ["active", "deactivated"] as const;
const roleValues = ["customer", "agent", "staff", "admin"] as const;

const listQueryShape = {
  page: yup.number().integer("page must be an integer").min(1, "page must be at least 1").default(1),
  limit: yup
    .number()
    .integer("limit must be an integer")
    .min(1, "limit must be at least 1")
    .max(100, "limit must be at most 100")
    .default(20),
  search: yup.string().trim().max(100),
  status: yup.string().oneOf(statusValues, "status must be active or deactivated"),
};

export const listUsersQuerySchema = yup.object({
  ...listQueryShape,
  role: yup.string().oneOf(roleValues, "Invalid role"),
});

export const listAgentsQuerySchema = yup.object(listQueryShape);

const idParam = (key: string, label: string) =>
  yup.object({
    [key]: yup.string().uuid(`Invalid ${label} id`).required(`${label} id is required`),
  });

export const userIdParamSchema = idParam("userId", "user");
export const agentIdParamSchema = idParam("agentId", "agent");
export const staffIdParamSchema = idParam("staffId", "staff");

const atLeastOne = (value: Record<string, unknown> | undefined): boolean =>
  value !== undefined && Object.values(value).some((field) => field !== undefined);

const nameField = yup.string().trim().min(1, "Name cannot be empty");
const statusField = yup
  .string()
  .oneOf(statusValues, "status must be active or deactivated");

export const updateUserSchema = yup
  .object({
    name: nameField,
    phone: phoneField.nullable(),
    status: statusField,
  })
  .test("at-least-one", "At least one field is required", atLeastOne);

export const updateAgentSchema = yup
  .object({
    name: nameField,
    phone: phoneField.nullable(),
    status: statusField,
    agencyName: yup.string().trim().max(150).nullable(),
  })
  .test("at-least-one", "At least one field is required", atLeastOne);

export const updateStaffSchema = updateUserSchema;

export const createAgentSchema = yup.object({
  name: yup.string().trim().required("Name is required"),
  email: emailField,
  phone: phoneField,
  agencyName: yup.string().trim().max(150),
});

export const createStaffSchema = yup.object({
  name: yup.string().trim().required("Name is required"),
  email: emailField,
  phone: phoneField,
});