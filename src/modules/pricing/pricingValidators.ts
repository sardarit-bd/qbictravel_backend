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