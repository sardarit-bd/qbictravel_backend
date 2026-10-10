import * as yup from "yup";

/**
 * @openapi
 * components:
 *   schemas:
 *     UpdateProfileRequest:
 *       type: object
 *       minProperties: 1
 *       properties:
 *         name:
 *           type: string
 *           example: John Doe
 *         phone:
 *           type: string
 *           nullable: true
 *           example: "+8801700000000"
 */

export const phoneField = yup
  .string()
  .trim()
  .matches(/^\+?[0-9][0-9\s\-()]{5,19}$/, "Invalid phone number");

export const updateProfileSchema = yup
  .object({
    name: yup.string().trim().min(1, "Name cannot be empty"),
    phone: phoneField.nullable(),
  })
  .test(
    "at-least-one",
    "At least one field (name or phone) is required",
    (value) =>
      value !== undefined &&
      Object.values(value).some((field) => field !== undefined),
  );