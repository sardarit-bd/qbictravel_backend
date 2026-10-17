import * as yup from "yup";
/**
 * @openapi
 * components:
 *   schemas:
 *     RegisterRequest:
 *       type: object
 *       required:
 *         - name
 *         - email
 *         - password
 *       properties:
 *         name:
 *           type: string
 *           example: John Doe
 *         email:
 *           type: string
 *           format: email
 *           example: john@example.com
 *         password:
 *           type: string
 *           minLength: 6
 *           maxLength: 72
 *           example: secret123
 *     LoginRequest:
 *       type: object
 *       required:
 *         - email
 *         - password
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           example: john@example.com
 *         password:
 *           type: string
 *           example: secret123
 *     ForgotPasswordRequest:
 *       type: object
 *       required:
 *         - email
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           example: john@example.com
 *     ResetPasswordRequest:
 *       type: object
 *       required:
 *         - token
 *         - password
 *       properties:
 *         token:
 *           type: string
 *           description: Token from the password recovery email link
 *         password:
 *           type: string
 *           minLength: 6
 *           maxLength: 72
 */
export const emailField = yup
    .string()
    .trim()
    .lowercase()
    .email("Invalid email format")
    .required("Email is required");
const passwordField = yup
    .string()
    .min(6, "Password must be at least 6 characters")
    .max(72, "Password must be at most 72 characters")
    .required("Password is required");
export const registerSchema = yup.object({
    name: yup.string().trim().required("Name is required"),
    email: emailField,
    password: passwordField,
});
export const loginSchema = yup.object({
    email: emailField,
    password: yup.string().required("Password is required"),
});
export const forgotPasswordSchema = yup.object({
    email: emailField,
});
export const resetPasswordSchema = yup.object({
    token: yup.string().required("Token is required"),
    password: passwordField,
});
