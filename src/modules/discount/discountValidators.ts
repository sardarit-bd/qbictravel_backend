import * as yup from "yup";

export const createStaffDiscountRequestSchema = yup.object({
  discountType: yup
    .string()
    .oneOf(["PERCENTAGE", "FIXED_AMOUNT"], "discountType must be either PERCENTAGE or FIXED_AMOUNT")
    .required("discountType is required"),
  discountValue: yup
    .number()
    .typeError("discountValue must be a number")
    .positive("discountValue must be greater than zero")
    .required("discountValue is required")
    .test(
      "percentage-cap",
      "Percentage discount must not exceed 100%",
      function (value) {
        const { discountType } = this.parent;
        if (discountType === "PERCENTAGE" && value !== undefined && value > 100) {
          return false;
        }
        return true;
      }
    ),
  reason: yup
    .string()
    .trim()
    .min(1, "Reason is required and cannot be empty")
    .max(1000, "Reason cannot exceed 1000 characters")
    .required("Reason is required"),
});

export const reviewStaffDiscountRequestSchema = yup.object({
  decision: yup
    .string()
    .oneOf(["APPROVE", "REJECT"], "decision must be either APPROVE or REJECT")
    .required("decision is required"),
  approvedDiscountValue: yup
    .number()
    .typeError("approvedDiscountValue must be a number")
    .positive("approvedDiscountValue must be greater than zero")
    .optional(),
  adminNotes: yup
    .string()
    .trim()
    .max(1000, "Admin notes cannot exceed 1000 characters")
    .optional(),
  rejectionReason: yup
    .string()
    .trim()
    .max(1000, "Rejection reason cannot exceed 1000 characters")
    .when("decision", {
      is: "REJECT",
      then: (schema) => schema.required("rejectionReason is required when rejecting a discount request").min(1, "rejectionReason cannot be empty"),
      otherwise: (schema) => schema.optional(),
    }),
});

export const listStaffDiscountRequestsQuerySchema = yup.object({
  page: yup.number().integer().min(1).default(1),
  limit: yup.number().integer().min(1).max(100).default(20),
  status: yup.string().oneOf(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  bookingId: yup.string().uuid("Invalid booking ID").optional(),
  requestedById: yup.string().uuid("Invalid requestedById").optional(),
  reviewedById: yup.string().uuid("Invalid reviewedById").optional(),
  startDate: yup.string().trim().optional(),
  endDate: yup.string().trim().optional(),
  search: yup.string().trim().optional(),
  sortBy: yup.string().oneOf(["createdAt", "updatedAt", "originalPrice", "discountAmount"]).default("createdAt"),
  sortOrder: yup.string().oneOf(["asc", "desc"]).default("desc"),
});

export const discountRequestIdParamSchema = yup.object({
  requestId: yup.string().uuid("Invalid discount request ID").required("requestId is required"),
});

export const bookingIdParamSchema = yup.object({
  bookingId: yup.string().uuid("Invalid booking ID").required("bookingId is required"),
});
