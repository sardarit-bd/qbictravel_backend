import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import {
  OmiseClient,
  OmiseError,
  thbToSatangs,
  satangsToThb,
} from "../../omiseClient.js";
import { validateOmiseConfig, getSafeOmiseDiagnostics } from "../../omiseConfig.js";

describe("Omise Amount Conversion Utilities", () => {
  it("converts THB decimal amounts to integer satangs correctly", () => {
    expect(thbToSatangs(100)).toBe(10000);
    expect(thbToSatangs(1500.5)).toBe(150050);
    expect(thbToSatangs(0.25)).toBe(25);
    expect(thbToSatangs(1234.56)).toBe(123456);
  });

  it("converts integer satangs to THB decimal correctly", () => {
    expect(satangsToThb(10000)).toBe(100);
    expect(satangsToThb(150050)).toBe(1500.5);
    expect(satangsToThb(25)).toBe(0.25);
  });

  it("throws OmiseError on invalid or non-positive THB amounts", () => {
    expect(() => thbToSatangs(0)).toThrow(OmiseError);
    expect(() => thbToSatangs(-50)).toThrow(OmiseError);
    expect(() => thbToSatangs(NaN)).toThrow(OmiseError);
  });

  it("throws OmiseError on invalid satang amounts", () => {
    expect(() => satangsToThb(-1)).toThrow(OmiseError);
    expect(() => satangsToThb(NaN)).toThrow(OmiseError);
  });
});

describe("Omise Configuration & Safe Diagnostics", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("validates and extracts configuration when OMISE_SECRET_KEY is present", () => {
    process.env.OMISE_PUBLIC_KEY = "pkey_test_123";
    process.env.OMISE_SECRET_KEY = "skey_test_abc";
    process.env.OMISE_WEBHOOK_SECRET = "whsec_test_xyz";

    const config = validateOmiseConfig();
    expect(config.publicKey).toBe("pkey_test_123");
    expect(config.secretKey).toBe("skey_test_abc");
    expect(config.webhookSecret).toBe("whsec_test_xyz");
    expect(config.baseUrl).toBe("https://api.omise.co");
  });

  it("throws an error when OMISE_SECRET_KEY is missing", () => {
    delete process.env.OMISE_SECRET_KEY;
    expect(() => validateOmiseConfig()).toThrow("OMISE_SECRET_KEY is required");
  });

  it("never exposes secret keys in diagnostics", () => {
    process.env.OMISE_PUBLIC_KEY = "pkey_test_123";
    process.env.OMISE_SECRET_KEY = "skey_test_supersecret";
    process.env.OMISE_WEBHOOK_SECRET = "whsec_test_webhooksecret";

    const diag = getSafeOmiseDiagnostics();
    expect(diag.isConfigured).toBe(true);
    expect(diag.hasPublicKey).toBe(true);
    expect(diag.hasSecretKey).toBe(true);
    expect(diag.hasWebhookSecret).toBe(true);

    const serialized = JSON.stringify(diag);
    expect(serialized).not.toContain("skey_test_supersecret");
    expect(serialized).not.toContain("whsec_test_webhooksecret");
  });
});

describe("OmiseClient Unit Tests", () => {
  const mockSecretKey = "skey_test_abcdef123456";
  const mockPublicKey = "pkey_test_123456abcdef";
  const mockWebhookSecret = "whsec_test_secret987";
  const mockBaseUrl = "https://api.omise.co";

  let client: OmiseClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    client = new OmiseClient({
      publicKey: mockPublicKey,
      secretKey: mockSecretKey,
      webhookSecret: mockWebhookSecret,
      baseUrl: mockBaseUrl,
      timeoutMs: 1000,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("correctly sets Basic Auth header with base64 encoded secret key", async () => {
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ object: "charge", id: "chrg_test_1", status: "successful" }),
      };
    });

    await client.retrieveCharge("chrg_test_1");

    const expectedCredentials = Buffer.from(`${mockSecretKey}:`).toString("base64");
    expect(capturedHeaders.Authorization).toBe(`Basic ${expectedCredentials}`);
    expect(capturedHeaders.Accept).toBe("application/json");
  });

  it("handles successful frictionless non-3DS charge creation", async () => {
    const mockChargeResponse = {
      object: "charge",
      id: "chrg_test_non3ds_123",
      location: "/charges/chrg_test_non3ds_123",
      amount: 150000,
      currency: "thb",
      status: "successful",
      authorized: true,
      paid: true,
      authorize_uri: null,
      card: {
        id: "card_test_123",
        last_digits: "4242",
        brand: "Visa",
      },
      created_at: "2026-11-23T10:00:00Z",
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(mockChargeResponse),
    });

    const result = await client.createCardCharge({
      amount: 1500, // 1500 THB = 150000 satangs
      token: "tokn_test_valid123",
      description: "Booking #BKG-123",
    });

    expect(result.id).toBe("chrg_test_non3ds_123");
    expect(result.status).toBe("successful");
    expect(result.authorized).toBe(true);
    expect(result.paid).toBe(true);
    expect(result.amount).toBe(150000);
  });

  it("handles pending 3-D Secure charge creation with authorize_uri", async () => {
    const mockChargeResponse = {
      object: "charge",
      id: "chrg_test_3ds_456",
      location: "/charges/chrg_test_3ds_456",
      amount: 250000,
      currency: "thb",
      status: "pending",
      authorized: false,
      paid: false,
      authorize_uri: "https://api.omise.co/charges/chrg_test_3ds_456/authorize",
      return_uri: "https://example.com/checkout/return",
      card: {
        id: "card_test_456",
        last_digits: "1234",
        brand: "MasterCard",
      },
      created_at: "2026-11-23T10:05:00Z",
    };

    let sentBody: any;
    globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
      sentBody = JSON.parse(init.body as string);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockChargeResponse),
      };
    });

    const result = await client.createCardCharge({
      amount: 2500,
      token: "tokn_test_3ds_token",
      returnUri: "https://example.com/checkout/return",
    });

    expect(result.id).toBe("chrg_test_3ds_456");
    expect(result.status).toBe("pending");
    expect(result.authorized).toBe(false);
    expect(result.authorize_uri).toBe("https://api.omise.co/charges/chrg_test_3ds_456/authorize");
    expect(sentBody.return_uri).toBe("https://example.com/checkout/return");
    expect(sentBody.amount).toBe(250000);
    expect(sentBody.card).toBe("tokn_test_3ds_token");
  });

  it("handles failed charge response from Omise", async () => {
    const mockFailedResponse = {
      object: "error",
      location: "https://docs.omise.co/api/errors#payment-rejected",
      code: "payment_rejected",
      message: "The card was declined by the issuing bank",
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify(mockFailedResponse),
    });

    await expect(
      client.createCardCharge({
        amount: 500,
        token: "tokn_test_declined",
      })
    ).rejects.toThrowError(OmiseError);

    await expect(
      client.createCardCharge({
        amount: 500,
        token: "tokn_test_declined",
      })
    ).rejects.toMatchObject({
      code: "payment_rejected",
      status: 400,
      message: "The card was declined by the issuing bank",
    });
  });

  it("retrieves charge by ID correctly", async () => {
    const mockCharge = {
      object: "charge",
      id: "chrg_test_get_789",
      amount: 300000,
      status: "successful",
    };

    let requestedUrl = "";
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      requestedUrl = url as string;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockCharge),
      };
    });

    const res = await client.retrieveCharge("chrg_test_get_789");
    expect(requestedUrl).toBe("https://api.omise.co/charges/chrg_test_get_789");
    expect(res.id).toBe("chrg_test_get_789");
    expect(res.status).toBe("successful");
  });

  it("creates refund with amount and reason", async () => {
    const mockRefund = {
      object: "refund",
      id: "rfnd_test_123",
      amount: 100000,
      currency: "thb",
      charge: "chrg_test_get_789",
      voided: false,
    };

    let sentBody: any;
    let targetUrl = "";
    globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
      targetUrl = url as string;
      sentBody = JSON.parse(init.body as string);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockRefund),
      };
    });

    const refundRes = await client.createRefund({
      chargeId: "chrg_test_get_789",
      amount: 1000, // 1000 THB = 100000 satangs
      reason: "Customer requested cancellation",
    });

    expect(targetUrl).toBe("https://api.omise.co/charges/chrg_test_get_789/refunds");
    expect(refundRes.id).toBe("rfnd_test_123");
    expect(sentBody.amount).toBe(100000);
    expect(sentBody.metadata?.reason).toBe("Customer requested cancellation");
  });

  it("validates token format and rejects invalid tokens without network call", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    await expect(
      client.createCardCharge({
        amount: 100,
        token: "",
      })
    ).rejects.toThrow("Omise card token is required");

    await expect(
      client.createCardCharge({
        amount: 100,
        token: "invalid_prefix_123",
      })
    ).rejects.toThrow("must start with tokn_");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("validates charge ID format on retrieval and refund", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    await expect(client.retrieveCharge("invalid_charge_id")).rejects.toThrow(
      "must start with chrg_"
    );
    await expect(
      client.createRefund({ chargeId: "not_a_charge" })
    ).rejects.toThrow("must start with chrg_");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("handles network timeouts gracefully", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      const abortErr = new Error("The operation was aborted");
      abortErr.name = "AbortError";
      throw abortErr;
    });

    await expect(
      client.createCardCharge({
        amount: 100,
        token: "tokn_test_123",
      })
    ).rejects.toMatchObject({
      code: "timeout",
      status: 504,
    });
  });

  it("ensures Secret Key is never exposed in error messages", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      throw new Error(`Connection failed with key ${mockSecretKey}`);
    });

    try {
      await client.retrieveCharge("chrg_test_123");
      expect.unreachable();
    } catch (err: any) {
      expect(err.message).not.toContain(mockSecretKey);
      expect(err.message).toContain("[REDACTED_SECRET_KEY]");
    }
  });

  it("verifies webhook signature correctly using HMAC-SHA256", () => {
    const payload = JSON.stringify({
      object: "event",
      id: "evnt_test_123",
      data: { id: "chrg_test_1" },
    });

    const signature = crypto
      .createHmac("sha256", mockWebhookSecret)
      .update(payload, "utf8")
      .digest("hex");

    expect(client.verifyWebhookSignature(payload, signature)).toBe(true);
    expect(client.verifyWebhookSignature(Buffer.from(payload), signature)).toBe(true);

    // Tampered payload
    expect(client.verifyWebhookSignature(payload + "tamper", signature)).toBe(false);

    // Wrong signature
    expect(client.verifyWebhookSignature(payload, "invalid_signature")).toBe(false);

    // Comma-separated rotated signatures
    const multiSig = `fake_sig_123, ${signature}`;
    expect(client.verifyWebhookSignature(payload, multiSig)).toBe(true);
  });
});
