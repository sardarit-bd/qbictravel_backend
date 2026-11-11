import crypto from "crypto";
import { v2 as cloudinary } from "cloudinary";
import nodemailer from "nodemailer";
import AppError from "../../shared/utils/AppError.js";
import logger from "../../shared/logger/logger.js";
import { sendEmail, resetTransporter } from "../../shared/utils/mailer.js";
import { maskSecret, verifyWebhookSignature } from "./settingCrypto.js";
import * as repo from "./settingRepository.js";
import {
  getRuntimeCloudinaryConfig,
  getRuntimeSmtpConfig,
  invalidateRuntimeConfigCache,
} from "./settingRuntimeConfig.js";
import type {
  SystemSettingsOverview,
  UpdateGeneralSettingsInput,
  UpdatePaymentSettingsInput,
  UpdateWebhookSettingsInput,
  UpdateCloudinarySettingsInput,
  UpdateSmtpSettingsInput,
  StripePaymentConfigSummary,
  PayPalPaymentConfigSummary,
  PaymentCredentialSource,
} from "./settingTypes.js";

export interface ActorContext {
  id: string;
  name: string;
  email: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * A credential is only considered present when it is a non-empty string.
 * Empty strings are treated as "not configured" so that an empty database
 * record can never shadow a valid environment variable.
 */
const hasCredentialValue = (value: string | null | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Resolve a credential using the documented precedence:
 * non-empty database value first, environment variable second.
 */
const resolveCredential = (
  dbValue: string | null | undefined,
  envValue: string | null | undefined
): { value: string; source: "database" | "environment" | "none" } => {
  if (hasCredentialValue(dbValue)) return { value: dbValue!.trim(), source: "database" };
  if (hasCredentialValue(envValue)) return { value: envValue!.trim(), source: "environment" };
  return { value: "", source: "none" };
};

/**
 * Best-effort environment detection from credential material. Used only when
 * no explicit environment is stored in the database.
 */
const detectStripeEnvironment = (
  secretKey: string,
  publishableKey: string
): "sandbox" | "live" | null => {
  if (/^sk_live_/.test(secretKey) || /^pk_live_/.test(publishableKey)) return "live";
  if (/^sk_test_/.test(secretKey) || /^pk_test_/.test(publishableKey)) return "sandbox";
  return null;
};

const detectPaypalEnvironment = (baseUrl: string | undefined): "sandbox" | "live" | null => {
  if (!baseUrl) return null;
  if (baseUrl.includes("sandbox.paypal.com")) return "sandbox";
  if (baseUrl.includes("api-m.paypal.com")) return "live";
  return null;
};

/**
 * Generate the public webhook endpoint URL.
 */
const getPublicWebhookUrl = (): string => {
  const backendBase =
    process.env.BACKEND_PUBLIC_URL ||
    (process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/:\d+$/, ":5000") : "http://localhost:5000");
  return `${backendBase.replace(/\/$/, "")}/api/v1/webhooks/payment`;
};

/**
 * Retrieve comprehensive configuration overview across all categories.
 * All sensitive credentials are safely masked.
 */
export const getSettingsOverview = async (): Promise<SystemSettingsOverview> => {
  const all = await repo.getAllSettings();
  const map = new Map(all.map((s) => [s.key, s]));

  // 1. General
  const isGeneralCustomized = Array.from(map.keys()).some((k) => k.startsWith("general."));
  const general = {
    platformName: map.get("general.platform_name")?.value || "PhuketTours",
    supportEmail: map.get("general.support_email")?.value || "support@phukettours.com",
    supportPhone: map.get("general.support_phone")?.value || "+66 76 123 4567",
    defaultCurrency: map.get("general.default_currency")?.value || "THB",
    timezone: map.get("general.timezone")?.value || "Asia/Bangkok",
    defaultLanguage: map.get("general.default_language")?.value || "en",
    maintenanceMode: map.get("general.maintenance_mode")?.value === "true",
    isCustomized: isGeneralCustomized,
    updatedAt: map.get("general.platform_name")?.updatedAt.toISOString() || null,
  };

  // 2. Payment
  // Precedence: a non-empty SystemSetting (database) value wins; otherwise the
  // process environment variable is used. Empty DB records never shadow env.
  const isPaymentCustomized = Array.from(map.keys()).some((k) => k.startsWith("payment."));

  // Legacy generic secret key (kept for backward compatibility).
  const legacySecretRecord = map.get("payment.secret_key");
  const legacySecret = legacySecretRecord?.encryptedValue
    ? await repo.getDecryptedSecretSetting("payment.secret_key")
    : null;
  const hasLegacySecretKey = hasCredentialValue(legacySecret);

  // Stripe credentials
  const dbStripeSecretRecord = map.get("payment.stripe.secret_key");
  const dbStripeSecret = dbStripeSecretRecord?.encryptedValue
    ? await repo.getDecryptedSecretSetting("payment.stripe.secret_key")
    : null;
  const dbStripeWebhookRecord = map.get("payment.stripe.webhook_secret");
  const dbStripeWebhookSecret = dbStripeWebhookRecord?.encryptedValue
    ? await repo.getDecryptedSecretSetting("payment.stripe.webhook_secret")
    : null;

  const stripeSecret = resolveCredential(dbStripeSecret, process.env.STRIPE_SECRET_KEY);
  const stripeWebhookSecret = resolveCredential(
    dbStripeWebhookSecret,
    process.env.STRIPE_WEBHOOK_SECRET
  );
  const stripePublishableKey = resolveCredential(
    map.get("payment.stripe.publishable_key")?.value || map.get("payment.publishable_key")?.value,
    process.env.STRIPE_PUBLISHABLE_KEY
  );

  // The legacy generic secret is a database-managed Stripe credential.
  const effectiveStripeSecret =
    stripeSecret.value || (hasLegacySecretKey ? legacySecret!.trim() : "");
  const stripeSecretSource: PaymentCredentialSource =
    stripeSecret.source !== "none"
      ? stripeSecret.source
      : hasLegacySecretKey
      ? "database"
      : "none";
  const stripeConfigured = hasCredentialValue(effectiveStripeSecret);
  const stripeEnabled =
    stripeConfigured && map.get("payment.stripe.enabled")?.value !== "false";
  const stripeEnvironment =
    (map.get("payment.stripe.environment")?.value as "sandbox" | "live") ||
    (map.get("payment.environment")?.value as "sandbox" | "live") ||
    detectStripeEnvironment(effectiveStripeSecret, stripePublishableKey.value) ||
    "sandbox";

  const stripeSummary: StripePaymentConfigSummary = {
    enabled: stripeEnabled,
    environment: stripeEnvironment,
    publishableKey: stripePublishableKey.value,
    hasSecretKey: stripeConfigured,
    maskedSecretKey: maskSecret(effectiveStripeSecret),
    hasWebhookSecret: hasCredentialValue(stripeWebhookSecret.value),
    maskedWebhookSecret: maskSecret(stripeWebhookSecret.value),
    configured: stripeConfigured,
    source: stripeSecretSource,
  };

  // PayPal credentials
  const dbPaypalSecretRecord = map.get("payment.paypal.client_secret");
  const dbPaypalSecret = dbPaypalSecretRecord?.encryptedValue
    ? await repo.getDecryptedSecretSetting("payment.paypal.client_secret")
    : null;

  const paypalClientId = resolveCredential(
    map.get("payment.paypal.client_id")?.value,
    process.env.PAYPAL_CLIENT_ID
  );
  const paypalClientSecret = resolveCredential(
    dbPaypalSecret,
    process.env.PAYPAL_CLIENT_SECRET
  );
  const paypalWebhookId = resolveCredential(
    map.get("payment.paypal.webhook_id")?.value,
    process.env.PAYPAL_WEBHOOK_ID
  );

  const paypalConfigured = Boolean(paypalClientId.value && paypalClientSecret.value);
  const paypalEnabled =
    paypalConfigured && map.get("payment.paypal.enabled")?.value !== "false";
  const paypalEnvironment =
    (map.get("payment.paypal.environment")?.value as "sandbox" | "live") ||
    (map.get("payment.environment")?.value as "sandbox" | "live") ||
    detectPaypalEnvironment(process.env.PAYPAL_BASE_URL) ||
    "sandbox";

  const paypalSummary: PayPalPaymentConfigSummary = {
    enabled: paypalEnabled,
    environment: paypalEnvironment,
    clientId: paypalClientId.value,
    hasClientSecret: hasCredentialValue(paypalClientSecret.value),
    maskedClientSecret: maskSecret(paypalClientSecret.value),
    webhookId: paypalWebhookId.value,
    configured: paypalConfigured,
    source: paypalClientSecret.source,
  };

  const activeProvider = (map.get("payment.active_provider")?.value as "stripe" | "paypal") || "stripe";

  const payment = {
    activeProvider,
    providerName: map.get("payment.provider_name")?.value || "Direct Bank & Cash",
    enabled: map.get("payment.enabled")?.value !== "false",
    environment: (map.get("payment.environment")?.value as "sandbox" | "live") || "sandbox",
    publishableKey: stripePublishableKey.value,
    hasSecretKey: stripeConfigured || hasLegacySecretKey,
    maskedSecretKey: maskSecret(effectiveStripeSecret || legacySecret),
    merchantId: map.get("payment.merchant_id")?.value || "",
    stripe: stripeSummary,
    paypal: paypalSummary,
    isCustomized: isPaymentCustomized,
    updatedAt: map.get("payment.provider_name")?.updatedAt.toISOString() || null,
  };

  // 3. Webhook
  const isWebhookCustomized = Array.from(map.keys()).some((k) => k.startsWith("webhook."));
  const hasSigningSecret = Boolean(map.get("webhook.signing_secret")?.encryptedValue);
  let maskedSigningSecret = "";
  if (hasSigningSecret) {
    const rawSigningSecret = await repo.getDecryptedSecretSetting("webhook.signing_secret");
    maskedSigningSecret = maskSecret(rawSigningSecret);
  }

  const webhook = {
    endpointUrl: getPublicWebhookUrl(),
    hasSigningSecret,
    maskedSigningSecret,
    enabled: map.get("webhook.enabled")?.value === "true",
    lastEventAt: map.get("webhook.last_event_at")?.value || null,
    lastEventType: map.get("webhook.last_event_type")?.value || null,
    lastVerifiedAt: map.get("webhook.last_verified_at")?.value || null,
    lastEventStatus: map.get("webhook.last_event_status")?.value || null,
    isCustomized: isWebhookCustomized,
    updatedAt: map.get("webhook.enabled")?.updatedAt.toISOString() || null,
  };

  // 4. Cloudinary
  const isCloudinaryCustomized = Array.from(map.keys()).some((k) => k.startsWith("cloudinary."));
  const dbCloudName = map.get("cloudinary.cloud_name")?.value;
  const dbApiKey = map.get("cloudinary.api_key")?.value;
  const hasApiSecret = Boolean(
    map.get("cloudinary.api_secret")?.encryptedValue || process.env.CLOUDINARY_API_SECRET
  );

  let rawApiSecret = "";
  if (map.get("cloudinary.api_secret")?.encryptedValue) {
    rawApiSecret = (await repo.getDecryptedSecretSetting("cloudinary.api_secret")) || "";
  } else if (process.env.CLOUDINARY_API_SECRET) {
    rawApiSecret = process.env.CLOUDINARY_API_SECRET;
  }

  let allowedFormats = ["jpg", "jpeg", "png", "webp", "avif"];
  const dbFormats = map.get("cloudinary.allowed_formats")?.value;
  if (dbFormats) {
    try {
      allowedFormats = JSON.parse(dbFormats);
    } catch {
      // keep default
    }
  }

  const isVerifiedCloudinary = map.get("cloudinary.is_verified")?.value;
  const connectionStatusCloudinary: "VERIFIED" | "FAILED" | "NOT_CONFIGURED" =
    isVerifiedCloudinary === "true"
      ? "VERIFIED"
      : isVerifiedCloudinary === "false"
      ? "FAILED"
      : (dbCloudName || process.env.CLOUDINARY_CLOUD_NAME) && hasApiSecret
      ? "VERIFIED"
      : "NOT_CONFIGURED";

  const cloudinaryConfig = {
    cloudName: dbCloudName || process.env.CLOUDINARY_CLOUD_NAME || "",
    apiKey: dbApiKey || process.env.CLOUDINARY_API_KEY || "",
    hasApiSecret,
    maskedApiSecret: maskSecret(rawApiSecret),
    folder: map.get("cloudinary.folder")?.value || "phukettours/tours",
    maxFileSizeBytes: map.get("cloudinary.max_file_size_bytes")?.value
      ? Number(map.get("cloudinary.max_file_size_bytes")?.value)
      : 10 * 1024 * 1024,
    allowedFormats,
    isVerified: connectionStatusCloudinary === "VERIFIED",
    connectionStatus: connectionStatusCloudinary,
    verifiedAt: map.get("cloudinary.verified_at")?.value || null,
    isCustomized: isCloudinaryCustomized,
    updatedAt: map.get("cloudinary.cloud_name")?.updatedAt.toISOString() || null,
  };

  // 5. SMTP
  const isSmtpCustomized = Array.from(map.keys()).some((k) => k.startsWith("smtp."));
  const dbHost = map.get("smtp.host")?.value;
  const dbPort = map.get("smtp.port")?.value;
  const dbSecure = map.get("smtp.secure")?.value;
  const dbUser = map.get("smtp.user")?.value;
  const hasPass = Boolean(map.get("smtp.pass")?.encryptedValue || process.env.SMTP_PASS);

  let rawPass = "";
  if (map.get("smtp.pass")?.encryptedValue) {
    rawPass = (await repo.getDecryptedSecretSetting("smtp.pass")) || "";
  } else if (process.env.SMTP_PASS) {
    rawPass = process.env.SMTP_PASS;
  }

  const isVerifiedSmtp = map.get("smtp.is_verified")?.value;
  const smtpHost = dbHost || process.env.SMTP_HOST || "";
  const connectionStatusSmtp: "VERIFIED" | "FAILED" | "NOT_CONFIGURED" =
    isVerifiedSmtp === "true"
      ? "VERIFIED"
      : isVerifiedSmtp === "false"
      ? "FAILED"
      : smtpHost
      ? "VERIFIED"
      : "NOT_CONFIGURED";

  const smtp = {
    host: smtpHost,
    port: dbPort ? Number(dbPort) : Number(process.env.SMTP_PORT) || 587,
    secure: dbSecure !== undefined ? dbSecure === "true" : process.env.SMTP_SECURE === "true",
    user: dbUser || process.env.SMTP_USER || "",
    hasPass,
    maskedPass: maskSecret(rawPass),
    fromEmail: map.get("smtp.from_email")?.value || process.env.SMTP_FROM_EMAIL || "noreply@phukettours.com",
    fromName: map.get("smtp.from_name")?.value || process.env.SMTP_FROM_NAME || "PhuketTours",
    enabled: map.get("smtp.enabled")?.value !== undefined ? map.get("smtp.enabled")?.value === "true" : Boolean(process.env.SMTP_HOST),
    isVerified: connectionStatusSmtp === "VERIFIED",
    connectionStatus: connectionStatusSmtp,
    verifiedAt: map.get("smtp.verified_at")?.value || null,
    isCustomized: isSmtpCustomized,
    updatedAt: map.get("smtp.host")?.updatedAt.toISOString() || null,
  };

  return {
    general,
    payment,
    webhook,
    cloudinary: cloudinaryConfig,
    smtp,
    serverTime: new Date().toISOString(),
  };
};

/**
 * Update General Platform Settings.
 */
export const updateGeneralSettings = async (
  input: UpdateGeneralSettingsInput,
  actor: ActorContext
) => {
  const updates: Array<Promise<unknown>> = [];

  if (input.platformName !== undefined) {
    updates.push(repo.setPlaintextSetting("GENERAL", "general.platform_name", input.platformName.trim(), actor.id));
  }
  if (input.supportEmail !== undefined) {
    updates.push(repo.setPlaintextSetting("GENERAL", "general.support_email", input.supportEmail.trim().toLowerCase(), actor.id));
  }
  if (input.supportPhone !== undefined) {
    updates.push(repo.setPlaintextSetting("GENERAL", "general.support_phone", input.supportPhone.trim(), actor.id));
  }
  if (input.timezone !== undefined) {
    updates.push(repo.setPlaintextSetting("GENERAL", "general.timezone", input.timezone.trim(), actor.id));
  }
  if (input.defaultLanguage !== undefined) {
    updates.push(repo.setPlaintextSetting("GENERAL", "general.default_language", input.defaultLanguage.trim().toLowerCase(), actor.id));
  }
  if (input.maintenanceMode !== undefined) {
    updates.push(repo.setPlaintextSetting("GENERAL", "general.maintenance_mode", String(input.maintenanceMode), actor.id));
  }

  await Promise.all(updates);
  invalidateRuntimeConfigCache();

  await repo.logSettingAudit({
    category: "GENERAL",
    action: "UPDATE_GENERAL_SETTINGS",
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    metadata: {
      updatedFields: Object.keys(input),
      maintenanceMode: input.maintenanceMode,
    },
  });

  return getSettingsOverview();
};

/**
 * Update Payment Gateway Settings.
 */
export const updatePaymentSettings = async (
  input: UpdatePaymentSettingsInput,
  actor: ActorContext
) => {
  const isGoingLive =
    input.environment === "live" ||
    input.stripe?.environment === "live" ||
    input.paypal?.environment === "live";

  if (isGoingLive && !input.confirmLiveMode) {
    throw new AppError(
      "Confirmation is required before switching Payment Gateway to Live Mode.",
      400
    );
  }

  const updates: Array<Promise<unknown>> = [];

  if (input.activeProvider !== undefined) {
    updates.push(repo.setPlaintextSetting("PAYMENT", "payment.active_provider", input.activeProvider, actor.id));
  }
  if (input.providerName !== undefined) {
    updates.push(repo.setPlaintextSetting("PAYMENT", "payment.provider_name", input.providerName.trim(), actor.id));
  }
  if (input.enabled !== undefined) {
    updates.push(repo.setPlaintextSetting("PAYMENT", "payment.enabled", String(input.enabled), actor.id));
  }
  if (input.environment !== undefined) {
    updates.push(repo.setPlaintextSetting("PAYMENT", "payment.environment", input.environment, actor.id));
  }
  // Never persist empty credential values: an empty DB record must not shadow
  // a valid environment variable. PayPal's client id is not a Stripe
  // publishable key, so it must not be written to the legacy publishable field.
  const isPaypalProvider = input.activeProvider === "paypal" || input.paypal !== undefined;
  if (input.publishableKey !== undefined && input.publishableKey.trim() && !isPaypalProvider) {
    updates.push(repo.setPlaintextSetting("PAYMENT", "payment.publishable_key", input.publishableKey.trim(), actor.id));
  }
  if (input.merchantId !== undefined && input.merchantId.trim()) {
    updates.push(repo.setPlaintextSetting("PAYMENT", "payment.merchant_id", input.merchantId.trim(), actor.id));
  }
  if (input.secretKey && input.secretKey.trim()) {
    updates.push(repo.setSecretSetting("PAYMENT", "payment.secret_key", input.secretKey.trim(), actor.id, "Payment Secret Key"));
  }

  // Stripe specific settings
  if (input.stripe) {
    if (input.stripe.enabled !== undefined) {
      updates.push(repo.setPlaintextSetting("PAYMENT", "payment.stripe.enabled", String(input.stripe.enabled), actor.id));
    }
    if (input.stripe.environment !== undefined) {
      updates.push(repo.setPlaintextSetting("PAYMENT", "payment.stripe.environment", input.stripe.environment, actor.id));
    }
    if (input.stripe.publishableKey !== undefined && input.stripe.publishableKey.trim()) {
      updates.push(repo.setPlaintextSetting("PAYMENT", "payment.stripe.publishable_key", input.stripe.publishableKey.trim(), actor.id));
      updates.push(repo.setPlaintextSetting("PAYMENT", "payment.publishable_key", input.stripe.publishableKey.trim(), actor.id));
    }
    if (input.stripe.secretKey && input.stripe.secretKey.trim()) {
      updates.push(repo.setSecretSetting("PAYMENT", "payment.stripe.secret_key", input.stripe.secretKey.trim(), actor.id, "Stripe Secret Key"));
      updates.push(repo.setSecretSetting("PAYMENT", "payment.secret_key", input.stripe.secretKey.trim(), actor.id, "Payment Secret Key"));
    }
    if (input.stripe.webhookSecret && input.stripe.webhookSecret.trim()) {
      updates.push(repo.setSecretSetting("PAYMENT", "payment.stripe.webhook_secret", input.stripe.webhookSecret.trim(), actor.id, "Stripe Webhook Secret"));
    }
  }

  // PayPal specific settings
  if (input.paypal) {
    if (input.paypal.enabled !== undefined) {
      updates.push(repo.setPlaintextSetting("PAYMENT", "payment.paypal.enabled", String(input.paypal.enabled), actor.id));
    }
    if (input.paypal.environment !== undefined) {
      updates.push(repo.setPlaintextSetting("PAYMENT", "payment.paypal.environment", input.paypal.environment, actor.id));
    }
    if (input.paypal.clientId !== undefined && input.paypal.clientId.trim()) {
      updates.push(repo.setPlaintextSetting("PAYMENT", "payment.paypal.client_id", input.paypal.clientId.trim(), actor.id));
    }
    if (input.paypal.clientSecret && input.paypal.clientSecret.trim()) {
      updates.push(repo.setSecretSetting("PAYMENT", "payment.paypal.client_secret", input.paypal.clientSecret.trim(), actor.id, "PayPal Client Secret"));
    }
    if (input.paypal.webhookId !== undefined && input.paypal.webhookId.trim()) {
      updates.push(repo.setPlaintextSetting("PAYMENT", "payment.paypal.webhook_id", input.paypal.webhookId.trim(), actor.id));
    }
  }

  await Promise.all(updates);
  invalidateRuntimeConfigCache();

  await repo.logSettingAudit({
    category: "PAYMENT",
    action: isGoingLive ? "ACTIVATE_LIVE_PAYMENT_MODE" : "UPDATE_PAYMENT_CREDENTIALS",
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    metadata: {
      activeProvider: input.activeProvider,
      providerName: input.providerName,
      environment: input.environment,
      enabled: input.enabled,
      hasSecretKeyReplaced: Boolean(input.secretKey?.trim() || input.stripe?.secretKey?.trim()),
      hasPaypalSecretReplaced: Boolean(input.paypal?.clientSecret?.trim()),
    },
  });

  return getSettingsOverview();
};

/**
 * Update Webhook Settings.
 */
export const updateWebhookSettings = async (
  input: UpdateWebhookSettingsInput,
  actor: ActorContext
) => {
  const updates: Array<Promise<unknown>> = [];

  if (input.enabled !== undefined) {
    updates.push(repo.setPlaintextSetting("WEBHOOK", "webhook.enabled", String(input.enabled), actor.id));
  }
  if (input.signingSecret && input.signingSecret.trim()) {
    updates.push(repo.setSecretSetting("WEBHOOK", "webhook.signing_secret", input.signingSecret.trim(), actor.id, "Webhook Signing Secret"));
  }

  await Promise.all(updates);
  invalidateRuntimeConfigCache();

  await repo.logSettingAudit({
    category: "WEBHOOK",
    action: "UPDATE_WEBHOOK_SETTINGS",
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    metadata: {
      enabled: input.enabled,
      hasSigningSecretReplaced: Boolean(input.signingSecret?.trim()),
    },
  });

  return getSettingsOverview();
};

/**
 * Update Cloudinary Credentials & Preferences.
 */
export const updateCloudinarySettings = async (
  input: UpdateCloudinarySettingsInput,
  actor: ActorContext
) => {
  const updates: Array<Promise<unknown>> = [];

  if (input.cloudName !== undefined) {
    updates.push(repo.setPlaintextSetting("CLOUDINARY", "cloudinary.cloud_name", input.cloudName.trim(), actor.id));
  }
  if (input.apiKey !== undefined) {
    updates.push(repo.setPlaintextSetting("CLOUDINARY", "cloudinary.api_key", input.apiKey.trim(), actor.id));
  }
  if (input.folder !== undefined) {
    updates.push(repo.setPlaintextSetting("CLOUDINARY", "cloudinary.folder", input.folder.trim(), actor.id));
  }
  if (input.maxFileSizeBytes !== undefined) {
    updates.push(repo.setPlaintextSetting("CLOUDINARY", "cloudinary.max_file_size_bytes", String(input.maxFileSizeBytes), actor.id));
  }
  if (input.allowedFormats !== undefined) {
    updates.push(repo.setPlaintextSetting("CLOUDINARY", "cloudinary.allowed_formats", JSON.stringify(input.allowedFormats), actor.id));
  }
  if (input.apiSecret && input.apiSecret.trim()) {
    updates.push(repo.setSecretSetting("CLOUDINARY", "cloudinary.api_secret", input.apiSecret.trim(), actor.id, "Cloudinary API Secret"));
  }

  // When credentials change, reset verification flag
  updates.push(repo.setPlaintextSetting("CLOUDINARY", "cloudinary.is_verified", "false", actor.id));

  await Promise.all(updates);
  invalidateRuntimeConfigCache();

  await repo.logSettingAudit({
    category: "CLOUDINARY",
    action: "UPDATE_CLOUDINARY_CREDENTIALS",
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    metadata: {
      cloudName: input.cloudName,
      hasApiKey: Boolean(input.apiKey),
      hasApiSecretReplaced: Boolean(input.apiSecret?.trim()),
    },
  });

  return getSettingsOverview();
};

/**
 * Perform a real live connection test against Cloudinary API.
 */
export const testCloudinaryConnection = async (actor: ActorContext) => {
  const config = await getRuntimeCloudinaryConfig();

  if (!config.cloudName || !config.apiKey || !config.apiSecret) {
    throw new AppError(
      "Cloudinary credentials are incomplete. Please configure Cloud Name, API Key, and API Secret first.",
      400
    );
  }

  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
    secure: true,
  });

  try {
    const pingResult = await cloudinary.api.ping();
    const verifiedAt = new Date().toISOString();

    await Promise.all([
      repo.setPlaintextSetting("CLOUDINARY", "cloudinary.is_verified", "true", actor.id),
      repo.setPlaintextSetting("CLOUDINARY", "cloudinary.verified_at", verifiedAt, actor.id),
    ]);
    invalidateRuntimeConfigCache();

    await repo.logSettingAudit({
      category: "CLOUDINARY",
      action: "TEST_CLOUDINARY_CONNECTION",
      status: "SUCCESS",
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      metadata: {
        cloudName: config.cloudName,
        status: pingResult.status,
      },
    });

    return {
      success: true,
      message: `Cloudinary connection verified successfully for cloud '${config.cloudName}'.`,
      verifiedAt,
    };
  } catch (error) {
    const errMsg = (error as Error).message || "Cloudinary connection test failed.";
    logger.error({ error: errMsg }, "Cloudinary connection test failed.");

    await repo.setPlaintextSetting("CLOUDINARY", "cloudinary.is_verified", "false", actor.id);
    invalidateRuntimeConfigCache();

    await repo.logSettingAudit({
      category: "CLOUDINARY",
      action: "TEST_CLOUDINARY_CONNECTION",
      status: "FAILURE",
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      metadata: {
        cloudName: config.cloudName,
        error: errMsg,
      },
    });

    throw new AppError(`Cloudinary connection failed: ${errMsg}`, 502);
  }
};

/**
 * Update SMTP Email Settings.
 */
export const updateSmtpSettings = async (
  input: UpdateSmtpSettingsInput,
  actor: ActorContext
) => {
  const updates: Array<Promise<unknown>> = [];

  if (input.host !== undefined) {
    updates.push(repo.setPlaintextSetting("SMTP", "smtp.host", input.host.trim(), actor.id));
  }
  if (input.port !== undefined) {
    updates.push(repo.setPlaintextSetting("SMTP", "smtp.port", String(input.port), actor.id));
  }
  if (input.secure !== undefined) {
    updates.push(repo.setPlaintextSetting("SMTP", "smtp.secure", String(input.secure), actor.id));
  }
  if (input.user !== undefined) {
    updates.push(repo.setPlaintextSetting("SMTP", "smtp.user", input.user.trim(), actor.id));
  }
  if (input.fromEmail !== undefined) {
    updates.push(repo.setPlaintextSetting("SMTP", "smtp.from_email", input.fromEmail.trim().toLowerCase(), actor.id));
  }
  if (input.fromName !== undefined) {
    updates.push(repo.setPlaintextSetting("SMTP", "smtp.from_name", input.fromName.trim(), actor.id));
  }
  if (input.enabled !== undefined) {
    updates.push(repo.setPlaintextSetting("SMTP", "smtp.enabled", String(input.enabled), actor.id));
  }
  if (input.pass && input.pass.trim()) {
    updates.push(repo.setSecretSetting("SMTP", "smtp.pass", input.pass.trim(), actor.id, "SMTP Password"));
  }

  // Reset verification flag when settings change
  updates.push(repo.setPlaintextSetting("SMTP", "smtp.is_verified", "false", actor.id));

  await Promise.all(updates);
  resetTransporter();
  invalidateRuntimeConfigCache();

  await repo.logSettingAudit({
    category: "SMTP",
    action: "UPDATE_SMTP_SETTINGS",
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    metadata: {
      host: input.host,
      port: input.port,
      secure: input.secure,
      hasPassReplaced: Boolean(input.pass?.trim()),
    },
  });

  return getSettingsOverview();
};

/**
 * Test SMTP connection using live transporter verification.
 */
export const testSmtpConnection = async (actor: ActorContext) => {
  const config = await getRuntimeSmtpConfig();

  if (!config.host || !config.port) {
    throw new AppError(
      "SMTP host and port must be configured before testing connection.",
      400
    );
  }

  const testTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
  } as any);

  try {
    await testTransporter.verify();
    const verifiedAt = new Date().toISOString();

    await Promise.all([
      repo.setPlaintextSetting("SMTP", "smtp.is_verified", "true", actor.id),
      repo.setPlaintextSetting("SMTP", "smtp.verified_at", verifiedAt, actor.id),
    ]);
    invalidateRuntimeConfigCache();

    await repo.logSettingAudit({
      category: "SMTP",
      action: "TEST_SMTP_CONNECTION",
      status: "SUCCESS",
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      metadata: {
        host: config.host,
        port: config.port,
        secure: config.secure,
      },
    });

    return {
      success: true,
      message: `SMTP connection to ${config.host}:${config.port} verified successfully.`,
      verifiedAt,
    };
  } catch (error) {
    const errMsg = (error as Error).message || "SMTP connection failed.";
    logger.error({ error: errMsg }, "SMTP verification test failed.");

    await repo.setPlaintextSetting("SMTP", "smtp.is_verified", "false", actor.id);
    invalidateRuntimeConfigCache();

    await repo.logSettingAudit({
      category: "SMTP",
      action: "TEST_SMTP_CONNECTION",
      status: "FAILURE",
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      metadata: {
        host: config.host,
        port: config.port,
        error: errMsg,
      },
    });

    throw new AppError(`SMTP verification failed: ${errMsg}`, 502);
  }
};

/**
 * Send an actual test email to verify end-to-end delivery.
 */
export const sendTestEmail = async (
  recipientEmail: string,
  actor: ActorContext
) => {
  const config = await getRuntimeSmtpConfig();

  if (!config.enabled) {
    throw new AppError("Email delivery is currently disabled in SMTP settings.", 400);
  }

  const subject = "PhuketTours — System Settings SMTP Test Email";
  const text = `Hello,\n\nThis is a verified test email sent from the PhuketTours Admin System Settings Center by administrator ${actor.name} (${actor.email}).\n\nIf you received this message, your SMTP outbound delivery is properly configured and operational.\n\nTimestamp: ${new Date().toISOString()}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e5eaed; border-radius: 12px; background-color: #ffffff;">
      <h2 style="color: #176779; margin-top: 0;">PhuketTours — SMTP Test Email</h2>
      <p style="color: #4b5563; font-size: 14px; line-height: 1.6;">
        This is a verified test email dispatched from the <strong>PhuketTours System Settings Center</strong>.
      </p>
      <div style="background-color: #f8fafb; border-left: 4px solid #176779; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
        <p style="margin: 0; font-size: 13px; color: #18282a;">
          <strong>Initiated by:</strong> ${actor.name} (${actor.email})<br>
          <strong>SMTP Host:</strong> ${config.host}:${config.port} (TLS: ${config.secure ? "Yes" : "STARTTLS"})<br>
          <strong>Dispatched At:</strong> ${new Date().toLocaleString()}
        </p>
      </div>
      <p style="color: #10b981; font-weight: 600; font-size: 14px;">
        ✓ Your outbound email delivery pipeline is verified and fully operational.
      </p>
    </div>
  `;

  try {
    const result = await sendEmail({
      to: recipientEmail,
      subject,
      text,
      html,
    });

    await repo.logSettingAudit({
      category: "SMTP",
      action: "SEND_TEST_EMAIL",
      status: "SUCCESS",
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      metadata: {
        recipientEmail,
        messageId: result.messageId,
      },
    });

    return {
      success: true,
      message: `Test email dispatched successfully to ${recipientEmail}.`,
      messageId: result.messageId,
    };
  } catch (error) {
    const errMsg = (error as Error).message || "Failed to dispatch test email.";
    logger.error({ error: errMsg, recipient: recipientEmail }, "Test email dispatch failed.");

    await repo.logSettingAudit({
      category: "SMTP",
      action: "SEND_TEST_EMAIL",
      status: "FAILURE",
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      metadata: {
        recipientEmail,
        error: errMsg,
      },
    });

    throw new AppError(`Failed to send test email: ${errMsg}`, 502);
  }
};

/**
 * Handle incoming payment webhooks with cryptographic HMAC SHA-256 verification.
 */
export const handlePaymentWebhook = async (
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  eventType: string = "payment.updated"
) => {
  const signingSecret = await repo.getDecryptedSecretSetting("webhook.signing_secret");

  if (!signingSecret) {
    logger.warn("Received webhook but no webhook signing secret is configured in system settings.");
    throw new AppError("Webhook verification unavailable: signing secret not configured", 503);
  }

  if (!signatureHeader) {
    await repo.setPlaintextSetting("WEBHOOK", "webhook.last_event_status", "REJECTED_MISSING_SIGNATURE");
    throw new AppError("Missing webhook signature header", 401);
  }

  const payloadString = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const isValid = verifyWebhookSignature(payloadString, signatureHeader, signingSecret);

  const now = new Date().toISOString();

  if (!isValid) {
    await Promise.all([
      repo.setPlaintextSetting("WEBHOOK", "webhook.last_event_at", now),
      repo.setPlaintextSetting("WEBHOOK", "webhook.last_event_type", eventType),
      repo.setPlaintextSetting("WEBHOOK", "webhook.last_event_status", "FAILED_SIGNATURE_MISMATCH"),
    ]);
    throw new AppError("Invalid webhook signature", 401);
  }

  // Signature is valid
  await Promise.all([
    repo.setPlaintextSetting("WEBHOOK", "webhook.last_event_at", now),
    repo.setPlaintextSetting("WEBHOOK", "webhook.last_event_type", eventType),
    repo.setPlaintextSetting("WEBHOOK", "webhook.last_verified_at", now),
    repo.setPlaintextSetting("WEBHOOK", "webhook.last_event_status", "VERIFIED"),
  ]);

  invalidateRuntimeConfigCache();

  return {
    verified: true,
    processedAt: now,
  };
};
