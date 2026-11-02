import * as yup from "yup";
import { COMMISSION_RATE_TYPES } from "./commissionTypes.js";

const twoDecimals = (value: number | undefined): boolean =>
  value === undefined || /^\d+(\.\d{1,2})?$/.test(String(value));

export const commissionIdParamSchema = yup.object({
  commissionId: yup.string().uuid("Invalid commission ID").required("Commission ID is required"),
});

export const configureCommissionRuleSchema = yup.object({
  rateType: yup
    .string()
    .oneOf([...COMMISSION_RATE_TYPES], "Rate type must be PERCENTAGE or FIXED")
    .required("Rate type is required"),
  rateValue: yup
    .number()
    .typeError("Rate value must be a number")
    .moreThan(0, "Rate value must be greater than 0")
    .max(99999999.99, "Rate value is too large")
    .test("two-decimals", "Rate value can have at most 2 decimal places", twoDecimals)
    .when("rateType", {
      is: "PERCENTAGE",
      then: (schema) => schema.max(100, "A percentage cannot exceed 100"),
      otherwise: (schema) => schema,
    })
    .required("Rate value is required"),
});

export const adjustCommissionSchema = yup.object({
  amount: yup
    .number()
    .typeError("Amount must be a number")
    .min(0, "Amount must be at least 0")
    .max(99999999.99, "Amount is too large")
    .test("two-decimals", "Amount can have at most 2 decimal places", twoDecimals)
    .required("Amount is required"),
  reason: yup
    .string()
    .trim()
    .min(3, "Reason is too short")
    .max(500, "Reason must be at most 500 characters")
    .required("A reason is required"),
});