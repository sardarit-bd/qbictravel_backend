import crypto from "crypto";
import { type OmiseConfig, validateOmiseConfig } from "./omiseConfig.js";

export interface OmiseCardDetails {
  id: string;
  name?: string;
  last_digits?: string;
  brand?: string;
  expiration_month?: number;
  expiration_year?: number;
  security_code_check?: boolean;
}

export interface OmiseChargeResponse {
  object: "charge";
  id: string;
  location: string;
  amount: number;
  currency: string;
  description?: string | null;
  status: "successful" | "pending" | "failed";
  authorized: boolean;
  paid: boolean;
  failure_code?: string | null;
  failure_message?: string | null;
  transaction?: string | null;
  card?: OmiseCardDetails | null;
  customer?: string | null;
  authorize_uri?: string | null;
  return_uri?: string | null;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface OmiseRefundResponse {
  object: "refund";
  id: string;
  location: string;
  amount: number;
  currency: string;
  charge: string;
  transaction?: string | null;
  voided: boolean;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface CreateOmiseChargeParams {
  amount: number; // in THB (major unit, e.g. 1500.50) OR integer satangs if satangs option is set
  token: string; // tokn_test_... or tokn_...
  returnUri?: string; // Required for 3DS authentication flow
  description?: string;
  metadata?: Record<string, any>;
}

export interface CreateOmiseRefundParams {
  chargeId: string;
  amount?: number; // in THB (major unit) or omitted for full refund
  reason?: string;
  metadata?: Record<string, any>;
}

export class OmiseError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly location?: string;

  constructor(message: string, code = "omise_error", status = 400, location?: string) {
    super(message);
    this.name = "OmiseError";
    this.code = code;
    this.status = status;
    this.location = location;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Sanitizes strings for safe error messages, ensuring secret keys are never leaked.
 */
function sanitizeSecret(text: string, secretKey: string): string {
  if (!secretKey) return text;
  return text.split(secretKey).join("[REDACTED_SECRET_KEY]");
}

/**
 * Converts a standard decimal THB amount to smallest currency unit (satangs as integer).
 * 1 THB = 100 satangs.
 */
export function thbToSatangs(amountThb: number): number {
  if (typeof amountThb !== "number" || isNaN(amountThb) || amountThb <= 0) {
    throw new OmiseError("Amount must be a positive number", "invalid_amount", 400);
  }
  // Math.round handles floating point rounding issues safely
  return Math.round(amountThb * 100);
}

/**
 * Converts integer satangs back to decimal THB.
 */
export function satangsToThb(satangs: number): number {
  if (typeof satangs !== "number" || isNaN(satangs) || satangs < 0) {
    throw new OmiseError("Satang amount must be a non-negative number", "invalid_amount", 400);
  }
  return satangs / 100;
}

export class OmiseClient {
  private publicKey: string;
  private secretKey: string;
  private webhookSecret: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(config?: OmiseConfig & { timeoutMs?: number }) {
    this.publicKey = config?.publicKey || process.env.OMISE_PUBLIC_KEY || "";
    this.secretKey = config?.secretKey || process.env.OMISE_SECRET_KEY || "";
    this.webhookSecret = config?.webhookSecret || process.env.OMISE_WEBHOOK_SECRET || "";
    this.baseUrl = (config?.baseUrl || process.env.OMISE_API_BASE_URL || "https://api.omise.co").replace(/\/+$/, "");
    this.timeoutMs = config?.timeoutMs || 20000;
  }

  public isConfigured(): boolean {
    return Boolean(this.secretKey);
  }

  private getAuthHeader(): string {
    if (!this.secretKey) {
      throw new OmiseError("Omise client is not configured with OMISE_SECRET_KEY", "unconfigured", 503);
    }
    const credentials = Buffer.from(`${this.secretKey}:`).toString("base64");
    return `Basic ${credentials}`;
  }

  private async request<T>(endpoint: string, options: { method?: string; body?: any } = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
    const method = options.method || "GET";
    const authHeader = this.getAuthHeader();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        Authorization: authHeader,
        Accept: "application/json",
      };

      let bodyPayload: string | undefined;
      if (options.body && (method === "POST" || method === "PATCH" || method === "PUT")) {
        headers["Content-Type"] = "application/json";
        bodyPayload = JSON.stringify(options.body);
      }

      const response = await fetch(url, {
        method,
        headers,
        body: bodyPayload,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();
      let responseJson: any;

      try {
        responseJson = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new OmiseError(
          `Unexpected non-JSON response from Omise (HTTP ${response.status})`,
          "invalid_json_response",
          response.status || 502,
        );
      }

      if (!response.ok) {
        const errorMessage =
          responseJson?.message || responseJson?.description || `Omise API error (HTTP ${response.status})`;
        const sanitizedMsg = sanitizeSecret(errorMessage, this.secretKey);
        const errorCode = responseJson?.code || `http_${response.status}`;
        throw new OmiseError(sanitizedMsg, errorCode, response.status, responseJson?.location);
      }

      return responseJson as T;
    } catch (err: any) {
      clearTimeout(timeoutId);

      if (err instanceof OmiseError) {
        throw err;
      }

      if (err.name === "AbortError" || err.code === "ABORT_ERR") {
        throw new OmiseError(`Omise API request timed out after ${this.timeoutMs}ms`, "timeout", 504);
      }

      const sanitizedMessage = sanitizeSecret(err?.message || "Network request failed", this.secretKey);
      throw new OmiseError(`Omise network error: ${sanitizedMessage}`, "network_error", 502);
    }
  }

  /**
   * Creates a card charge with Omise.
   * - Token must start with 'tokn_'
   * - Amount is converted to integer satangs (THB only)
   * - returnUri is included for 3DS authentication
   */
  public async createCardCharge(params: CreateOmiseChargeParams): Promise<OmiseChargeResponse> {
    if (!params.token || typeof params.token !== "string" || !params.token.trim()) {
      throw new OmiseError("Omise card token is required", "invalid_token", 400);
    }

    if (!params.token.startsWith("tokn_")) {
      throw new OmiseError("Invalid card token format; must start with tokn_", "invalid_token", 400);
    }

    const satangs = thbToSatangs(params.amount);

    const payload: Record<string, any> = {
      amount: satangs,
      currency: "thb",
      card: params.token.trim(),
    };

    if (params.returnUri) {
      payload.return_uri = params.returnUri;
    }

    if (params.description) {
      payload.description = params.description;
    }

    if (params.metadata && Object.keys(params.metadata).length > 0) {
      payload.metadata = params.metadata;
    }

    return this.request<OmiseChargeResponse>("/charges", {
      method: "POST",
      body: payload,
    });
  }

  /**
   * Retrieves charge details by charge ID (chrg_test_... or chrg_...).
   */
  public async retrieveCharge(chargeId: string): Promise<OmiseChargeResponse> {
    if (!chargeId || typeof chargeId !== "string" || !chargeId.trim()) {
      throw new OmiseError("Charge ID is required", "invalid_charge_id", 400);
    }

    const trimmedId = chargeId.trim();
    if (!trimmedId.startsWith("chrg_")) {
      throw new OmiseError("Invalid charge ID format; must start with chrg_", "invalid_charge_id", 400);
    }

    return this.request<OmiseChargeResponse>(`/charges/${trimmedId}`);
  }

  /**
   * Creates a full or partial refund for a captured charge.
   */
  public async createRefund(params: CreateOmiseRefundParams): Promise<OmiseRefundResponse> {
    if (!params.chargeId || typeof params.chargeId !== "string" || !params.chargeId.trim()) {
      throw new OmiseError("Charge ID is required for refund", "invalid_charge_id", 400);
    }

    const trimmedChargeId = params.chargeId.trim();
    if (!trimmedChargeId.startsWith("chrg_")) {
      throw new OmiseError("Invalid charge ID format; must start with chrg_", "invalid_charge_id", 400);
    }

    const payload: Record<string, any> = {};

    if (params.amount !== undefined) {
      payload.amount = thbToSatangs(params.amount);
    }

    if (params.reason) {
      payload.metadata = {
        ...(params.metadata || {}),
        reason: params.reason,
      };
    } else if (params.metadata) {
      payload.metadata = params.metadata;
    }

    return this.request<OmiseRefundResponse>(`/charges/${trimmedChargeId}/refunds`, {
      method: "POST",
      body: payload,
    });
  }

  /**
   * Cryptographically verifies an Omise webhook signature.
   * Omise sends `Omise-Signature` (HMAC-SHA256 hex) and optionally timestamp headers.
   */
  public verifyWebhookSignature(
    rawBody: Buffer | string,
    signatureHeader: string,
    secretOverride?: string,
  ): boolean {
    const secret = secretOverride || this.webhookSecret;
    if (!signatureHeader || !secret) {
      return false;
    }

    const payloadString = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(payloadString, "utf8")
      .digest("hex");

    // Split on comma in case of rolled webhook secrets during 24-hr grace period
    const candidateSignatures = signatureHeader.split(",").map((s) => s.trim());

    for (const sig of candidateSignatures) {
      try {
        const sigBuf = Buffer.from(sig, "hex");
        const expBuf = Buffer.from(expectedSignature, "hex");
        if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
          return true;
        }
      } catch {
        // continue
      }
    }

    return false;
  }
}

export const defaultOmiseClient = new OmiseClient();
