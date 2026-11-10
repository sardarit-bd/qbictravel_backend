import crypto from "crypto";

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  webhookId?: string;
}

export interface PayPalCreateOrderParams {
  bookingId: string;
  amount: number;
  currency: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  customId?: string;
}

export interface PayPalOrderResponse {
  id: string;
  status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";
  links: Array<{
    href: string;
    rel: string;
    method: string;
  }>;
}

export interface PayPalCaptureResponse {
  id: string;
  status: "COMPLETED" | "DECLINED" | "PARTIALLY_REFUNDED" | "PENDING" | "REFUNDED" | "FAILED";
  purchase_units?: Array<{
    reference_id?: string;
    payments?: {
      captures?: Array<{
        id: string;
        status: string;
        amount: {
          value: string;
          currency_code: string;
        };
        custom_id?: string;
      }>;
    };
  }>;
}

export class PayPalClient {
  private clientId: string;
  private clientSecret: string;
  private baseUrl: string;
  private webhookId: string;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(config?: Partial<PayPalConfig>) {
    this.clientId = config?.clientId ?? "";
    this.clientSecret = config?.clientSecret ?? "";
    this.baseUrl = (
      config?.baseUrl ||
      process.env.PAYPAL_BASE_URL ||
      (process.env.NODE_ENV === "production"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com")
    ).replace(/\/$/, "");
    this.webhookId = config?.webhookId || process.env.PAYPAL_WEBHOOK_ID || "";
  }

  public isAvailable(): boolean {
    const id = this.clientId || process.env.PAYPAL_CLIENT_ID;
    const secret = this.clientSecret || process.env.PAYPAL_CLIENT_SECRET;
    return Boolean(id && secret);
  }

  private async getAccessToken(): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error("PayPal client credentials are not configured.");
    }

    const now = Date.now();
    if (this.accessToken && this.tokenExpiresAt > now + 60000) {
      return this.accessToken;
    }

    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to obtain PayPal OAuth token (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiresAt = now + (data.expires_in || 3600) * 1000;
    return this.accessToken;
  }

  public async createOrder(params: PayPalCreateOrderParams): Promise<PayPalOrderResponse> {
    const token = await this.getAccessToken();

    const payload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: params.bookingId,
          custom_id: params.customId || params.bookingId,
          description: params.description.slice(0, 127),
          amount: {
            currency_code: params.currency.toUpperCase(),
            value: params.amount.toFixed(2),
          },
        },
      ],
      application_context: {
        brand_name: "PhuketTours",
        landing_page: "NO_PREFERENCE",
        user_action: "PAY_NOW",
        return_url: params.returnUrl,
        cancel_url: params.cancelUrl,
      },
    };

    const response = await fetch(`${this.baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`PayPal Create Order error (${response.status}): ${errBody}`);
    }

    return (await response.json()) as PayPalOrderResponse;
  }

  public async captureOrder(orderId: string): Promise<PayPalCaptureResponse> {
    const token = await this.getAccessToken();

    const response = await fetch(`${this.baseUrl}/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`PayPal Capture Order error (${response.status}): ${errBody}`);
    }

    return (await response.json()) as PayPalCaptureResponse;
  }

  public async retrieveOrder(orderId: string): Promise<PayPalOrderResponse> {
    const token = await this.getAccessToken();

    const response = await fetch(`${this.baseUrl}/v2/checkout/orders/${orderId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`PayPal Retrieve Order error (${response.status}): ${errBody}`);
    }

    return (await response.json()) as PayPalOrderResponse;
  }

  /**
   * Verify webhook signature using PayPal's verification API endpoint
   */
  public async verifyWebhookSignature(params: {
    authAlgo: string;
    certUrl: string;
    transmissionId: string;
    transmissionSig: string;
    transmissionTime: string;
    webhookEvent: any;
  }): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      const token = await this.getAccessToken();
      const webhookId = this.webhookId || process.env.PAYPAL_WEBHOOK_ID || "";

      if (!webhookId) {
        console.warn("[PayPalClient] Webhook verification skipped: PAYPAL_WEBHOOK_ID is not configured");
        return false;
      }

      const verifyPayload = {
        auth_algo: params.authAlgo,
        cert_url: params.certUrl,
        transmission_id: params.transmissionId,
        transmission_sig: params.transmissionSig,
        transmission_time: params.transmissionTime,
        webhook_id: webhookId,
        webhook_event: params.webhookEvent,
      };

      const response = await fetch(`${this.baseUrl}/v1/notifications/verify-webhook-signature`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(verifyPayload),
      });

      if (!response.ok) {
        return false;
      }

      const data = (await response.json()) as { verification_status: string };
      return data.verification_status === "SUCCESS";
    } catch (err) {
      console.error("[PayPalClient] Error verifying webhook signature:", err);
      return false;
    }
  }
}

export const defaultPayPalClient = new PayPalClient();

