import * as yup from "yup";

export const trackClickSchema = yup.object({
  code: yup.string().trim().min(3).max(32).required("Referral code is required"),
  landingUrl: yup.string().trim().max(1000).default("/"),
  referrer: yup.string().trim().max(1000).nullable().optional(),
  linkId: yup.string().uuid().nullable().optional(),
});

export const applyAffiliateSchema = yup.object({
  websiteUrl: yup.string().trim().max(500).nullable().optional(),
  promotionChannels: yup.string().trim().max(1000).nullable().optional(),
  payoutMethod: yup.string().trim().max(100).nullable().optional(),
  payoutDetails: yup.object().nullable().optional(),
});

export const affiliateBankDetailsSchema = yup.object({
  bankName: yup.string().trim().min(2, "Bank name must be at least 2 characters").max(100).required("Bank name is required"),
  accountHolderName: yup.string().trim().min(2, "Account holder name must be at least 2 characters").max(100).required("Account holder name is required"),
  accountNumber: yup.string().trim().min(5, "Account number must be at least 5 characters").max(40).required("Account number is required"),
  branchName: yup.string().trim().max(100).nullable().optional(),
  swiftBic: yup.string().trim().max(30).nullable().optional(),
  routingNumber: yup.string().trim().max(30).nullable().optional(),
});

export const updateAffiliateProfileSchema = yup.object({
  websiteUrl: yup.string().trim().max(500).nullable().optional(),
  promotionChannels: yup.string().trim().max(1000).nullable().optional(),
  payoutMethod: yup.string().trim().max(100).nullable().optional(),
  payoutDetails: yup.object().nullable().optional(),
  bankDetails: affiliateBankDetailsSchema.nullable().optional(),
});

export const createAffiliateLinkSchema = yup.object({
  label: yup.string().trim().max(120).nullable().optional(),
  tourId: yup.string().uuid().nullable().optional(),
  targetPath: yup
    .string()
    .trim()
    .matches(/^\/[^\s]*$/, "targetPath must start with /")
    .max(500)
    .optional(),
});

export const updateAffiliateLinkSchema = yup.object({
  label: yup.string().trim().max(120).optional(),
  isActive: yup.boolean().optional(),
});

export const requestPayoutSchema = yup.object({
  amount: yup
    .number()
    .typeError("Amount must be a number")
    .positive("Amount must be greater than 0")
    .required("Amount is required"),
  payoutMethod: yup.string().trim().min(2).max(100).optional(),
  payoutDetails: yup.object().nullable().optional(),
});

export const rejectReasonSchema = yup.object({
  reason: yup.string().trim().min(3, "Rejection reason is required").max(1000).required("Rejection reason is required"),
});

export const setCommissionRateSchema = yup.object({
  commissionRateOverride: yup
    .number()
    .typeError("Commission rate must be a number")
    .min(0, "Rate must be at least 0%")
    .max(100, "Rate cannot exceed 100%")
    .nullable()
    .defined(),
});

export const updateAffiliateSettingsSchema = yup.object({
  globalCommissionRate: yup.number().min(0).max(100).optional(),
  attributionWindowDays: yup.number().integer().min(1).max(365).optional(),
  minimumPayoutAmount: yup.number().min(0).optional(),
  eligibleAmountPolicy: yup.string().oneOf(["NET_AFTER_DISCOUNTS", "GROSS"]).optional(),
  isProgramActive: yup.boolean().optional(),
});

export const markPayoutPaidSchema = yup.object({
  payoutMethod: yup.string().trim().min(2).max(100).optional(),
  transactionReference: yup.string().trim().min(2, "Transaction reference is required").max(200).required("Transaction reference is required"),
  paidAt: yup.string().optional(),
  notes: yup.string().trim().max(1000).nullable().optional(),
});
