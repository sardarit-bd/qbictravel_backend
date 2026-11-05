import logger from "../../shared/logger/logger.js";
import { getAllSettings, getDecryptedSecretSetting } from "./settingRepository.js";

export interface RuntimeCloudinaryCredentials {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  folder: string;
  maxFileSizeBytes: number;
  allowedFormats: string[];
}

export interface RuntimeSmtpCredentials {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
  enabled: boolean;
}

export interface RuntimeGeneralSettings {
  platformName: string;
  supportEmail: string;
  supportPhone: string;
  defaultCurrency: string;
  timezone: string;
  defaultLanguage: string;
  maintenanceMode: boolean;
}

export interface RuntimePaymentCredentials {
  providerName: string;
  enabled: boolean;
  environment: "sandbox" | "live";
  publishableKey: string;
  secretKey: string;
  merchantId: string;
}

export interface RuntimeWebhookConfig {
  signingSecret: string;
  enabled: boolean;
}

// In-memory cache
let cachedCloudinary: RuntimeCloudinaryCredentials | null = null;
let cachedSmtp: RuntimeSmtpCredentials | null = null;
let cachedGeneral: RuntimeGeneralSettings | null = null;
let cachedPayment: RuntimePaymentCredentials | null = null;
let cachedWebhook: RuntimeWebhookConfig | null = null;

/**
 * Invalidate in-memory runtime cache.
 * Called immediately after setting updates are persisted.
 */
export const invalidateRuntimeConfigCache = (): void => {
  cachedCloudinary = null;
  cachedSmtp = null;
  cachedGeneral = null;
  cachedPayment = null;
  cachedWebhook = null;
  logger.info("System settings runtime configuration cache invalidated.");
};

/**
 * Resolve Cloudinary credentials at runtime.
 * Precedence: Database configuration -> process.env fallback.
 */
export const getRuntimeCloudinaryConfig = async (): Promise<RuntimeCloudinaryCredentials> => {
  if (cachedCloudinary) return cachedCloudinary;

  try {
    const settings = await getAllSettings();
    const map = new Map(settings.map((s) => [s.key, s]));

    const dbCloudName = map.get("cloudinary.cloud_name")?.value;
    const dbApiKey = map.get("cloudinary.api_key")?.value;
    const dbFolder = map.get("cloudinary.folder")?.value;
    const dbMaxSize = map.get("cloudinary.max_file_size_bytes")?.value;
    const dbFormats = map.get("cloudinary.allowed_formats")?.value;

    let dbApiSecret: string | null = null;
    if (map.get("cloudinary.api_secret")?.isSecret) {
      dbApiSecret = await getDecryptedSecretSetting("cloudinary.api_secret");
    }

    const cloudName = dbCloudName?.trim() || process.env.CLOUDINARY_CLOUD_NAME || "";
    const apiKey = dbApiKey?.trim() || process.env.CLOUDINARY_API_KEY || "";
    const apiSecret = dbApiSecret?.trim() || process.env.CLOUDINARY_API_SECRET || "";
    const folder = dbFolder?.trim() || "phukettours/tours";
    const maxFileSizeBytes = dbMaxSize ? Number(dbMaxSize) : 10 * 1024 * 1024;
    let allowedFormats = ["jpg", "jpeg", "png", "webp", "avif"];
    if (dbFormats) {
      try {
        allowedFormats = JSON.parse(dbFormats);
      } catch {
        // use default
      }
    }

    cachedCloudinary = {
      cloudName,
      apiKey,
      apiSecret,
      folder,
      maxFileSizeBytes,
      allowedFormats,
    };
    return cachedCloudinary;
  } catch (error) {
    logger.error(
      { error: (error as Error).message },
      "Error resolving runtime Cloudinary config from database. Falling back to env."
    );
    return {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
      apiKey: process.env.CLOUDINARY_API_KEY || "",
      apiSecret: process.env.CLOUDINARY_API_SECRET || "",
      folder: "phukettours/tours",
      maxFileSizeBytes: 10 * 1024 * 1024,
      allowedFormats: ["jpg", "jpeg", "png", "webp", "avif"],
    };
  }
};

/**
 * Resolve SMTP credentials at runtime.
 * Precedence: Database configuration -> process.env fallback.
 */
export const getRuntimeSmtpConfig = async (): Promise<RuntimeSmtpCredentials> => {
  if (cachedSmtp) return cachedSmtp;

  try {
    const settings = await getAllSettings();
    const map = new Map(settings.map((s) => [s.key, s]));

    const dbHost = map.get("smtp.host")?.value;
    const dbPort = map.get("smtp.port")?.value;
    const dbSecure = map.get("smtp.secure")?.value;
    const dbUser = map.get("smtp.user")?.value;
    const dbFromEmail = map.get("smtp.from_email")?.value;
    const dbFromName = map.get("smtp.from_name")?.value;
    const dbEnabled = map.get("smtp.enabled")?.value;

    let dbPass: string | null = null;
    if (map.get("smtp.pass")?.isSecret) {
      dbPass = await getDecryptedSecretSetting("smtp.pass");
    }

    const host = dbHost?.trim() || process.env.SMTP_HOST || "";
    const port = dbPort ? Number(dbPort) : Number(process.env.SMTP_PORT) || 587;
    const secure = dbSecure !== undefined ? dbSecure === "true" : process.env.SMTP_SECURE === "true";
    const user = dbUser?.trim() || process.env.SMTP_USER || "";
    const pass = dbPass?.trim() || process.env.SMTP_PASS || "";
    const fromEmail = dbFromEmail?.trim() || process.env.SMTP_FROM_EMAIL || "noreply@phukettours.com";
    const fromName = dbFromName?.trim() || process.env.SMTP_FROM_NAME || "PhuketTours";
    const enabled = dbEnabled !== undefined ? dbEnabled === "true" : Boolean(host);

    cachedSmtp = {
      host,
      port,
      secure,
      user,
      pass,
      fromEmail,
      fromName,
      enabled,
    };
    return cachedSmtp;
  } catch (error) {
    logger.error(
      { error: (error as Error).message },
      "Error resolving runtime SMTP config from database. Falling back to env."
    );
    return {
      host: process.env.SMTP_HOST || "",
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
      fromEmail: process.env.SMTP_FROM_EMAIL || "noreply@phukettours.com",
      fromName: process.env.SMTP_FROM_NAME || "PhuketTours",
      enabled: Boolean(process.env.SMTP_HOST),
    };
  }
};

/**
 * Resolve General Settings at runtime.
 */
export const getRuntimeGeneralConfig = async (): Promise<RuntimeGeneralSettings> => {
  if (cachedGeneral) return cachedGeneral;

  try {
    const settings = await getAllSettings();
    const map = new Map(settings.map((s) => [s.key, s]));

    cachedGeneral = {
      platformName: map.get("general.platform_name")?.value || "PhuketTours",
      supportEmail: map.get("general.support_email")?.value || "support@phukettours.com",
      supportPhone: map.get("general.support_phone")?.value || "+66 76 123 4567",
      defaultCurrency: map.get("general.default_currency")?.value || "THB",
      timezone: map.get("general.timezone")?.value || "Asia/Bangkok",
      defaultLanguage: map.get("general.default_language")?.value || "en",
      maintenanceMode: map.get("general.maintenance_mode")?.value === "true",
    };
    return cachedGeneral;
  } catch (error) {
    logger.error({ error: (error as Error).message }, "Error resolving runtime general config.");
    return {
      platformName: "PhuketTours",
      supportEmail: "support@phukettours.com",
      supportPhone: "+66 76 123 4567",
      defaultCurrency: "THB",
      timezone: "Asia/Bangkok",
      defaultLanguage: "en",
      maintenanceMode: false,
    };
  }
};

/**
 * Resolve Payment Gateway credentials at runtime.
 */
export const getRuntimePaymentConfig = async (): Promise<RuntimePaymentCredentials> => {
  if (cachedPayment) return cachedPayment;

  try {
    const settings = await getAllSettings();
    const map = new Map(settings.map((s) => [s.key, s]));

    const providerName = map.get("payment.provider_name")?.value || "Direct Bank & Cash";
    const enabled = map.get("payment.enabled")?.value !== "false";
    const environment = (map.get("payment.environment")?.value as "sandbox" | "live") || "sandbox";
    const publishableKey = map.get("payment.publishable_key")?.value || "";
    const merchantId = map.get("payment.merchant_id")?.value || "";

    let secretKey = "";
    if (map.get("payment.secret_key")?.isSecret) {
      secretKey = (await getDecryptedSecretSetting("payment.secret_key")) || "";
    }

    cachedPayment = {
      providerName,
      enabled,
      environment,
      publishableKey,
      secretKey,
      merchantId,
    };
    return cachedPayment;
  } catch (error) {
    logger.error({ error: (error as Error).message }, "Error resolving runtime payment config.");
    return {
      providerName: "Direct Bank & Cash",
      enabled: true,
      environment: "sandbox",
      publishableKey: "",
      secretKey: "",
      merchantId: "",
    };
  }
};

/**
 * Resolve Webhook configuration at runtime.
 */
export const getRuntimeWebhookConfig = async (): Promise<RuntimeWebhookConfig> => {
  if (cachedWebhook) return cachedWebhook;

  try {
    const settings = await getAllSettings();
    const map = new Map(settings.map((s) => [s.key, s]));

    let signingSecret = "";
    if (map.get("webhook.signing_secret")?.isSecret) {
      signingSecret = (await getDecryptedSecretSetting("webhook.signing_secret")) || "";
    }
    const enabled = map.get("webhook.enabled")?.value === "true";

    cachedWebhook = {
      signingSecret,
      enabled,
    };
    return cachedWebhook;
  } catch (error) {
    logger.error({ error: (error as Error).message }, "Error resolving runtime webhook config.");
    return {
      signingSecret: "",
      enabled: false,
    };
  }
};
