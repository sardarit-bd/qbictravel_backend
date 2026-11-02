import * as yup from "yup";

export const createPricingRuleSchema = yup.object({
  name: yup.string().trim().required("Name is required"),
  description: yup.string().trim().optional(),
  type: yup.string().oneOf(["AGENT_DISCOUNT_LIMIT"], "Invalid rule type").required("Type is required"),
  value: yup.number().min(0, "Value must be at least 0").required("Value is required"),
  agentId: yup.string().uuid("Invalid agent ID").optional(),
  serviceId: yup.string().uuid("Invalid service ID").optional(),
  isActive: yup.boolean().optional(),
});

export const updatePricingRuleSchema = yup.object({
  name: yup.string().trim().optional(),
  description: yup.string().trim().nullable().optional(),
  value: yup.number().min(0, "Value must be at least 0").optional(),
  isActive: yup.boolean().optional(),
});

export const pricingRuleIdParamSchema = yup.object({
  ruleId: yup.string().uuid("Invalid pricing rule ID").required("Pricing rule ID is required"),
});

const maxTwoDecimals = (value?: number | null) =>
  value === undefined || value === null || Math.round(value * 100) / 100 === value;

export const bookingIdParamSchema = yup.object({
  bookingId: yup.string().uuid("Invalid booking ID").required("Booking ID is required"),
});

export const proposeBookingPriceSchema = yup.object({
  price: yup
    .number()
    .typeError("Price must be a number")
    .moreThan(0, "Price must be greater than 0")
    .test("max-two-decimals", "Price can have at most 2 decimal places", maxTwoDecimals)
    .required("Price is required"),
  notes: yup.string().trim().max(500, "Notes must be at most 500 characters").optional(),
});

export const reviewPriceApprovalSchema = yup.object({
  decision: yup
    .string()
    .oneOf(["APPROVED", "REJECTED"], "Decision must be APPROVED or REJECTED")
    .required("Decision is required"),
  approvedPrice: yup
    .number()
    .typeError("Approved price must be a number")
    .moreThan(0, "Approved price must be greater than 0")
    .test("max-two-decimals", "Approved price can have at most 2 decimal places", maxTwoDecimals)
    .optional(),
  notes: yup.string().trim().max(500, "Notes must be at most 500 characters").optional(),
});