import * as yup from "yup";
import { PAYMENT_METHODS } from "./paymentTypes.js";

export const paymentIdParamSchema = yup.object({
  paymentId: yup.string().uuid("Invalid payment ID").required("Payment ID is required"),
});

export const paymentBookingIdParamSchema = yup.object({
  bookingId: yup.string().uuid("Invalid booking ID").required("Booking ID is required"),
});

export const createPaymentSchema = yup.object({
  method: yup
    .string()
    .oneOf([...PAYMENT_METHODS], "Invalid payment method")
    .required("Payment method is required"),
  reference: yup.string().trim().min(3, "Reference is too short").max(100, "Reference is too long").optional(),
  receiptNote: yup.string().trim().max(500, "Receipt note must be at most 500 characters").optional(),
});

const stripeRedirectUrlValidator = yup
  .string()
  .trim()
  .test("is-valid-stripe-redirect-url", "${path} must be a valid HTTP or HTTPS URL", (value) => {
    if (value === undefined || value === null || value === "") {
      return true;
    }
    try {
      // Stripe uses literal {CHECKOUT_SESSION_ID} placeholder in success URLs.
      // Standard URI parsers treat { and } as unescaped characters; substitute safely for verification.
      const normalized = value.replace(/\{CHECKOUT_SESSION_ID\}/g, "DUMMY_SESSION_ID");
      const parsed = new URL(normalized);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  });

export const createStripeSessionSchema = yup.object({
  successUrl: stripeRedirectUrlValidator.optional(),
  cancelUrl: stripeRedirectUrlValidator.optional(),
});

export const verifyPaymentSchema = yup.object({
  decision: yup
    .string()
    .oneOf(["VERIFIED", "REJECTED"], "Decision must be VERIFIED or REJECTED")
    .required("Decision is required"),
  notes: yup
    .string()
    .trim()
    .max(500, "Notes must be at most 500 characters")
    .when("decision", {
      is: "REJECTED",
      then: (schema) => schema.required("Notes are required when rejecting a payment"),
      otherwise: (schema) => schema.optional(),
    }),
});

export const recordPaymentSchema = yup.object({
  reference: yup.string().trim().min(3, "Reference is too short").max(100, "Reference is too long").optional(),
  receivedAt: yup.date().typeError("Invalid received date").optional(),
  notes: yup.string().trim().max(500, "Notes must be at most 500 characters").optional(),
});
