import * as yup from "yup";

export const updateGeneralSettingsSchema = yup.object({
  platformName: yup.string().trim().min(2, "Platform name must be at least 2 characters").max(100).optional(),
  supportEmail: yup.string().trim().email("Invalid support email address").optional(),
  supportPhone: yup.string().trim().min(5, "Support phone must be at least 5 characters").max(30).optional(),
  defaultCurrency: yup.string().trim().length(3, "Currency code must be exactly 3 characters (e.g. THB)").optional(),
  timezone: yup.string().trim().min(2, "Timezone is required").max(100).optional(),
  defaultLanguage: yup.string().trim().min(2, "Language code must be at least 2 characters").max(10).optional(),
  maintenanceMode: yup.boolean().optional(),
});

export const updatePaymentSettingsSchema = yup.object({
  providerName: yup.string().trim().min(2, "Provider name must be at least 2 characters").max(100).optional(),
  enabled: yup.boolean().optional(),
  environment: yup.string().oneOf(["sandbox", "live"], "Environment must be sandbox or live").optional(),
  publishableKey: yup.string().trim().max(500).optional(),
  secretKey: yup.string().trim().min(8, "Secret key must be at least 8 characters").max(500).optional(),
  merchantId: yup.string().trim().max(100).optional(),
  confirmLiveMode: yup.boolean().optional(),
});

export const updateWebhookSettingsSchema = yup.object({
  signingSecret: yup.string().trim().min(8, "Webhook signing secret must be at least 8 characters").max(500).optional(),
  enabled: yup.boolean().optional(),
});

export const updateCloudinarySettingsSchema = yup.object({
  cloudName: yup.string().trim().min(2, "Cloud Name must be at least 2 characters").max(100).optional(),
  apiKey: yup.string().trim().min(2, "API Key must be at least 2 characters").max(100).optional(),
  apiSecret: yup.string().trim().min(6, "API Secret must be at least 6 characters").max(500).optional(),
  folder: yup.string().trim().min(2, "Folder path must be at least 2 characters").max(200).optional(),
  maxFileSizeBytes: yup.number().positive("Max file size must be positive").optional(),
  allowedFormats: yup.array().of(yup.string().trim()).min(1, "At least one format required").optional(),
});

export const updateSmtpSettingsSchema = yup.object({
  host: yup.string().trim().min(2, "SMTP Host must be at least 2 characters").max(200).optional(),
  port: yup.number().integer().min(1).max(65535, "Port must be between 1 and 65535").optional(),
  secure: yup.boolean().optional(),
  user: yup.string().trim().max(150).optional(),
  pass: yup.string().trim().min(4, "SMTP password must be at least 4 characters").max(500).optional(),
  fromEmail: yup.string().trim().email("Invalid sender email address").optional(),
  fromName: yup.string().trim().max(100).optional(),
  enabled: yup.boolean().optional(),
});

export const sendTestEmailSchema = yup.object({
  recipientEmail: yup.string().trim().email("A valid recipient email is required").required("Recipient email is required"),
});

export const listAuditLogsQuerySchema = yup.object({
  category: yup.string().trim().uppercase().optional(),
  status: yup.string().trim().uppercase().optional(),
  page: yup.number().integer().min(1).default(1),
  limit: yup.number().integer().min(1).max(100).default(20),
});
