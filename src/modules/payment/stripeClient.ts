import crypto from "crypto";

export interface StripeEventPayload {
  id: string;
  type: string;
  data: {
    object: Record<string, any>;
  };
  created: number;
  [key: string]: any;
}

export interface StripeCheckoutSessionResponse {
  id: string;
  url: string;
  payment_intent?: string | null;
  status?: string | null;
  payment_status?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
  expires_at?: number;
}

export interface StripePaymentIntentResponse {
  id: string;
  status: string;
  amount: number;
  currency: string;
  metadata?: Record<string, string>;
  last_payment_error?: {
    message?: string;
    code?: string;
  } | null;
}

/**
 * Validates Stripe webhook signatures using HMAC-SHA256 according to Stripe documentation.
 * Header format: t=timestamp,v1=signature[,v1=signature2...]
 * Signed payload: `${timestamp}.${rawBody}`
 */
export const verifyWebhookSignature = (
  rawBody: Buffer | string,
  signatureHeader: string,
  secret: string,
  toleranceSeconds = 300,
): boolean => {
  if (!signatureHeader || !secret) {
    return false;
  }

  const parts = signatureHeader.split(",");
  let timestamp = -1;
  const signatures: string[] = [];

  for (const part of parts) {
    const [key, value] = part.trim().split("=");
    if (key === "t") {
      timestamp = parseInt(value, 10);
    } else if (key === "v1" && value) {
      signatures.push(value);
    }
  }

  if (timestamp === -1 || signatures.length === 0 || Number.isNaN(timestamp)) {
    return false;
  }

  // Tolerance check (default 5 minutes)
  const now = Math.floor(Date.now() / 1000);
  if (toleranceSeconds > 0 && Math.abs(now - timestamp) > toleranceSeconds) {
    return false;
  }

  const payloadString = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
  const signedPayload = `${timestamp}.${payloadString}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  for (const sig of signatures) {
    try {
      const sigBuf = Buffer.from(sig, "hex");
      const expBuf = Buffer.from(expectedSignature, "hex");
      if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
        return true;
      }
    } catch {
      // Continue checking next signature
    }
  }

  return false;
};

/**
 * Interface representing Stripe API operations required for Checkout Sessions and PaymentIntents.
 * Can be implemented by real Stripe SDK or HTTP client, or mocked in test suites.
 */
export interface IStripeClient {
  createCheckoutSession(params: {
    bookingId: string;
    customerId: string;
    amountMinor: number;
    currency: string;
    customerEmail?: string;
    serviceTitle: string;
    successUrl: string;
    cancelUrl: string;
    expiresAt?: number;
    idempotencyKey?: string;
  }): Promise<StripeCheckoutSessionResponse>;

  retrieveCheckoutSession(sessionId: string): Promise<StripeCheckoutSessionResponse>;

  expireCheckoutSession(sessionId: string): Promise<StripeCheckoutSessionResponse>;

  retrievePaymentIntent(paymentIntentId: string): Promise<StripePaymentIntentResponse>;
}

/**
 * Standard implementation that uses direct HTTPS fetch to Stripe API v1.
 * This ensures no external npm packages are required, while honoring exact Stripe REST API specs.
 */
export class StripeHttpClient implements IStripeClient {
  private apiKey: string;
  private baseUrl = "https://api.stripe.com/v1";

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.STRIPE_SECRET_KEY || "";
  }

  private async request<T>(
    endpoint: string,
    method = "GET",
    bodyParams?: Record<string, any>,
    idempotencyKey?: string,
  ): Promise<T> {
    if (!this.apiKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Stripe-Version": "2024-12-18.acacia",
    };

    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    let body: string | undefined;
    if (bodyParams && (method === "POST" || method === "PUT")) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      const usp = new URLSearchParams();
      const flatten = (obj: any, prefix = "") => {
        for (const key of Object.keys(obj)) {
          const val = obj[key];
          const newPrefix = prefix ? `${prefix}[${key}]` : key;
          if (val !== null && typeof val === "object" && !Array.isArray(val)) {
            flatten(val, newPrefix);
          } else if (val !== undefined && val !== null) {
            usp.append(newPrefix, String(val));
          }
        }
      };
      flatten(bodyParams);
      body = usp.toString();
    }

    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers,
      body,
    });

    const data = await res.json();
    if (!res.ok) {
      const msg = data.error?.message || "Stripe API error";
      const err = new Error(msg) as any;
      err.stripeError = data.error;
      err.status = res.status;
      throw err;
    }

    return data as T;
  }

  async createCheckoutSession(params: {
    bookingId: string;
    customerId: string;
    amountMinor: number;
    currency: string;
    customerEmail?: string;
    serviceTitle: string;
    successUrl: string;
    cancelUrl: string;
    expiresAt?: number;
    idempotencyKey?: string;
  }): Promise<StripeCheckoutSessionResponse> {
    const body: Record<string, any> = {
      mode: "payment",
      client_reference_id: params.bookingId,
      currency: params.currency.toLowerCase(),
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      "payment_method_types[0]": "card",
      "metadata[bookingId]": params.bookingId,
      "metadata[customerId]": params.customerId,
      "line_items[0][price_data][currency]": params.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": params.amountMinor,
      "line_items[0][price_data][product_data][name]": `Tour Booking: ${params.serviceTitle}`,
      "line_items[0][quantity]": 1,
    };

    if (params.customerEmail) {
      body.customer_email = params.customerEmail;
    }
    if (params.expiresAt) {
      body.expires_at = params.expiresAt;
    }

    return this.request<StripeCheckoutSessionResponse>(
      "/checkout/sessions",
      "POST",
      body,
      params.idempotencyKey,
    );
  }

  async retrieveCheckoutSession(sessionId: string): Promise<StripeCheckoutSessionResponse> {
    return this.request<StripeCheckoutSessionResponse>(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
  }

  async expireCheckoutSession(sessionId: string): Promise<StripeCheckoutSessionResponse> {
    return this.request<StripeCheckoutSessionResponse>(
      `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`,
      "POST",
      {},
    );
  }

  async retrievePaymentIntent(paymentIntentId: string): Promise<StripePaymentIntentResponse> {
    return this.request<StripePaymentIntentResponse>(`/payment_intents/${encodeURIComponent(paymentIntentId)}`);
  }
}

