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

export interface PaymentGatewaySummary {
  providerName: string;
  enabled: boolean;
  environment: "sandbox" | "live";
  publishableKey: string;
  hasSecretKey: boolean;
  maskedSecretKey: string;
  merchantId: string;
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
  defaultCurrency?: string;
  timezone?: string;
  defaultLanguage?: string;
  maintenanceMode?: boolean;
}

export interface UpdatePaymentSettingsInput {
  providerName?: string;
  enabled?: boolean;
  environment?: "sandbox" | "live";
  publishableKey?: string;
  secretKey?: string;
  merchantId?: string;
  confirmLiveMode?: boolean;
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

export interface SettingAuditLogItem {
  id: string;
  category: string;
  action: string;
  status: string;
  actorId: string | null;
  actorName: string;
  actorEmail: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ListSettingAuditLogsQuery {
  category?: string;
  status?: string;
  page?: number;
  limit?: number;
}
