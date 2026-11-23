export interface OmiseConfig {
  publicKey?: string;
  secretKey?: string;
  webhookSecret?: string;
  baseUrl?: string;
}

export interface ValidatedOmiseConfig {
  publicKey: string;
  secretKey: string;
  webhookSecret: string;
  baseUrl: string;
}

/**
 * Validates and safely retrieves Omise configuration without exposing secrets.
 */
export function validateOmiseConfig(overrides?: OmiseConfig): ValidatedOmiseConfig {
  const publicKey = overrides?.publicKey || process.env.OMISE_PUBLIC_KEY || "";
  const secretKey = overrides?.secretKey || process.env.OMISE_SECRET_KEY || "";
  const webhookSecret = overrides?.webhookSecret || process.env.OMISE_WEBHOOK_SECRET || "";
  const baseUrl = (overrides?.baseUrl || process.env.OMISE_API_BASE_URL || "https://api.omise.co").replace(/\/+$/, "");

  if (!secretKey) {
    throw new Error("OMISE_SECRET_KEY is required for Omise payment operations");
  }

  return {
    publicKey,
    secretKey,
    webhookSecret,
    baseUrl,
  };
}

/**
 * Returns safe Omise configuration metadata for diagnostics/logging.
 * Never exposes the actual Secret Key or Webhook Secret.
 */
export function getSafeOmiseDiagnostics(overrides?: OmiseConfig): {
  isConfigured: boolean;
  hasPublicKey: boolean;
  hasSecretKey: boolean;
  hasWebhookSecret: boolean;
  baseUrl: string;
} {
  const publicKey = overrides?.publicKey || process.env.OMISE_PUBLIC_KEY || "";
  const secretKey = overrides?.secretKey || process.env.OMISE_SECRET_KEY || "";
  const webhookSecret = overrides?.webhookSecret || process.env.OMISE_WEBHOOK_SECRET || "";
  const baseUrl = (overrides?.baseUrl || process.env.OMISE_API_BASE_URL || "https://api.omise.co").replace(/\/+$/, "");

  return {
    isConfigured: Boolean(secretKey),
    hasPublicKey: Boolean(publicKey),
    hasSecretKey: Boolean(secretKey),
    hasWebhookSecret: Boolean(webhookSecret),
    baseUrl,
  };
}
