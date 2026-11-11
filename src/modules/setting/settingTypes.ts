export interface GeneralSettingsSummary {
  platformName: string;
  supportEmail: string;
  supportPhone: string;
  defaultCurrency: string;
  timezone: string;
  defaultLanguage: string;
  maintenanceMode: boolean;
  isCustomized: boolean;
  updatedAt?: string | null;
}

/**
 * Where the effective payment credentials are sourced from.
 * - "database": stored in the encrypted SystemSetting table.
 * - "environment": provided through process environment variables.
 * - "none": no credential is configured from either source.
 */
export type PaymentCredentialSource = "database" | "environment" | "none";

export interface StripePaymentConfigSummary {
  /**
   * Effective availability. Never true when required credentials are missing.
   * Reflects the DB preference (payment.stripe.enabled) gated by `configured`.
   */
  enabled: boolean;
  environment: "sandbox" | "live";
  publishableKey: string;
  hasSecretKey: boolean;
  maskedSecretKey: string;
  hasWebhookSecret: boolean;
  maskedWebhookSecret: string;
  /** True when the required secret key is available (DB or env). */
  configured: boolean;
  /** Source of the primary (secret key) credential. */
  source: PaymentCredentialSource;
}

export interface PayPalPaymentConfigSummary {
  /**
   * Effective availability. Never true when required credentials are missing.
   * Reflects the DB preference (payment.paypal.enabled) gated by `configured`.
   */
  enabled: boolean;
  environment: "sandbox" | "live";
  clientId: string;
  hasClientSecret: boolean;
  maskedClientSecret: string;
  webhookId: string;
  /** True when both client id and client secret are available (DB or env). */
  configured: boolean;
  /** Source of the primary (client secret) credential. */
  source: PaymentCredentialSource;
}

export interface PaymentGatewaySummary {
  activeProvider: "stripe" | "paypal";
  providerName: string;
  enabled: boolean;
  environment: "sandbox" | "live";
  publishableKey: string;
  hasSecretKey: boolean;
  maskedSecretKey: string;
  merchantId: string;
  stripe: StripePaymentConfigSummary;
  paypal: PayPalPaymentConfigSummary;
  isCustomized: boolean;
  updatedAt?: string | null;
}

export interface WebhookConfigSummary {
  endpointUrl: string;
  hasSigningSecret: boolean;
  maskedSigningSecret: string;
  enabled: boolean;
  lastEventAt: string | null;
  lastEventType: string | null;
  lastVerifiedAt: string | null;
  lastEventStatus: string | null;
  isCustomized: boolean;
  updatedAt?: string | null;
}

export interface CloudinaryConfigSummary {
  cloudName: string;
  apiKey: string;
  hasApiSecret: boolean;
  maskedApiSecret: string;
  folder: string;
  maxFileSizeBytes: number;
  allowedFormats: string[];
  isVerified: boolean;
  connectionStatus: "VERIFIED" | "FAILED" | "NOT_CONFIGURED";
  verifiedAt: string | null;
  isCustomized: boolean;
  updatedAt?: string | null;
}

export interface SmtpConfigSummary {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  hasPass: boolean;
  maskedPass: string;
  fromEmail: string;
  fromName: string;
  enabled: boolean;
  isVerified: boolean;
  connectionStatus: "VERIFIED" | "FAILED" | "NOT_CONFIGURED";
  verifiedAt: string | null;
  isCustomized: boolean;
  updatedAt?: string | null;
}

export interface SystemSettingsOverview {
  general: GeneralSettingsSummary;
  payment: PaymentGatewaySummary;
  webhook: WebhookConfigSummary;
  cloudinary: CloudinaryConfigSummary;
  smtp: SmtpConfigSummary;
  serverTime: string;
}

export interface UpdateGeneralSettingsInput {
  platformName?: string;
  supportEmail?: string;
  supportPhone?: string;
  timezone?: string;
  defaultLanguage?: string;
  maintenanceMode?: boolean;
}

export interface UpdatePaymentSettingsInput {
  activeProvider?: "stripe" | "paypal";
  providerName?: string;
  enabled?: boolean;
  environment?: "sandbox" | "live";
  publishableKey?: string;
  secretKey?: string;
  merchantId?: string;
  confirmLiveMode?: boolean;

  // Provider-specific configs
  stripe?: {
    enabled?: boolean;
    environment?: "sandbox" | "live";
    publishableKey?: string;
    secretKey?: string;
    webhookSecret?: string;
  };
  paypal?: {
    enabled?: boolean;
    environment?: "sandbox" | "live";
    clientId?: string;
    clientSecret?: string;
    webhookId?: string;
  };
}

export interface UpdateWebhookSettingsInput {
  signingSecret?: string;
  enabled?: boolean;
}

export interface UpdateCloudinarySettingsInput {
  cloudName?: string;
  apiKey?: string;
  apiSecret?: string;
  folder?: string;
  maxFileSizeBytes?: number;
  allowedFormats?: string[];
}

export interface UpdateSmtpSettingsInput {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  fromEmail?: string;
  fromName?: string;
  enabled?: boolean;
}

export interface SendTestEmailInput {
  recipientEmail: string;
}
