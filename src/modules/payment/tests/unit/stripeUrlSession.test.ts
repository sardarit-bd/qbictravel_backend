import { describe, it, expect, vi, beforeEach } from "vitest";
import * as paymentService from "../../paymentService.js";
import { createStripeSessionSchema } from "../../paymentValidators.js";
import * as paymentRepository from "../../paymentRepository.js";
import type { IStripeClient } from "../../stripeClient.js";

const { resolveStripeSessionUrls, createStripeCheckoutSession, setStripeClient } = paymentService;

describe("Stripe Checkout Session URL Generation & Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("paymentValidators - createStripeSessionSchema", () => {
    it("accepts valid localhost success URL containing literal {CHECKOUT_SESSION_ID}", async () => {
      const payload = {
        successUrl: "http://localhost:3000/checkout/success?session_id={CHECKOUT_SESSION_ID}",
        cancelUrl: "http://localhost:3000/checkout/cancel",
      };
      await expect(createStripeSessionSchema.validate(payload)).resolves.toEqual(payload);
    });

    it("accepts valid production HTTPS URLs with query parameters", async () => {
      const payload = {
        successUrl: "https://72.61.112.137/checkout/success?bookingId=b-123&session_id={CHECKOUT_SESSION_ID}",
        cancelUrl: "https://72.61.112.137/checkout/cancel?bookingId=b-123",
      };
      await expect(createStripeSessionSchema.validate(payload)).resolves.toEqual(payload);
    });

    it("rejects relative URLs", async () => {
      const payload = {
        successUrl: "/checkout/success?session_id={CHECKOUT_SESSION_ID}",
        cancelUrl: "/checkout/cancel",
      };
      await expect(createStripeSessionSchema.validate(payload)).rejects.toThrow();
    });

    it("rejects unsupported protocols (e.g. javascript or ftp)", async () => {
      const payload = {
        successUrl: "javascript:alert(1)",
        cancelUrl: "ftp://localhost/checkout/cancel",
      };
      await expect(createStripeSessionSchema.validate(payload)).rejects.toThrow();
    });

    it("accepts undefined or omitted URLs (fallback to server-generated defaults)", async () => {
      const payload = {};
      await expect(createStripeSessionSchema.validate(payload)).resolves.toEqual({});
    });
  });

  describe("paymentService - resolveStripeSessionUrls", () => {
    const bookingId = "b-test-1234";

    it("generates valid localhost success and cancel URLs for local development", () => {
      const urls = resolveStripeSessionUrls(
        bookingId,
        undefined,
        "http://localhost:3000",
        false
      );

      expect(urls.successUrl).toBe(
        "http://localhost:3000/checkout/success?session_id={CHECKOUT_SESSION_ID}&bookingId=b-test-1234"
      );
      expect(urls.cancelUrl).toBe(
        "http://localhost:3000/checkout/cancel?bookingId=b-test-1234"
      );
      // Strictly preserves {CHECKOUT_SESSION_ID}
      expect(urls.successUrl).toContain("{CHECKOUT_SESSION_ID}");
    });

    it("generates valid production HTTPS URLs", () => {
      const urls = resolveStripeSessionUrls(
        bookingId,
        undefined,
        "https://72.61.112.137",
        true
      );

      expect(urls.successUrl).toBe(
        "https://72.61.112.137/checkout/success?session_id={CHECKOUT_SESSION_ID}&bookingId=b-test-1234"
      );
      expect(urls.cancelUrl).toBe(
        "https://72.61.112.137/checkout/cancel?bookingId=b-test-1234"
      );
      expect(urls.successUrl.startsWith("https://")).toBe(true);
      expect(urls.cancelUrl.startsWith("https://")).toBe(true);
    });

    it("throws a clear error when frontend origin is missing or empty", () => {
      expect(() => {
        resolveStripeSessionUrls(bookingId, undefined, "", false);
      }).toThrow("Frontend application origin (FRONTEND_URL) is not configured");

      expect(() => {
        resolveStripeSessionUrls(bookingId, undefined, undefined, false);
      }).not.toThrow(); // uses default env.frontendUrl if defined
    });

    it("throws a clear error when frontend origin is invalid or not an absolute URL", () => {
      expect(() => {
        resolveStripeSessionUrls(bookingId, undefined, "not-a-valid-url", false);
      }).toThrow(/Invalid FRONTEND_URL origin configuration/);
    });

    it("throws a clear error in production if frontend origin is not HTTPS", () => {
      expect(() => {
        resolveStripeSessionUrls(bookingId, undefined, "http://insecure-domain.com", true);
      }).toThrow(/Production environment requires HTTPS/);
    });

    it("preserves client-provided absolute URLs if provided and valid", () => {
      const customSuccess = "https://custom.phukettours.com/checkout/success?session_id={CHECKOUT_SESSION_ID}";
      const customCancel = "https://custom.phukettours.com/checkout/cancel";

      const urls = resolveStripeSessionUrls(
        bookingId,
        { successUrl: customSuccess, cancelUrl: customCancel },
        "https://custom.phukettours.com",
        true
      );

      expect(urls.successUrl).toBe(customSuccess);
      expect(urls.cancelUrl).toBe(customCancel);
    });
  });

  describe("paymentService - createStripeCheckoutSession flow", () => {
    const customerId = "c-user-123";
    const bookingId = "b-book-456";

    it("passes correct payload with preserved {CHECKOUT_SESSION_ID} to Stripe client", async () => {
      const mockStripeClient: IStripeClient = {
        createCheckoutSession: vi.fn().mockResolvedValue({
          id: "cs_test_mock_123",
          url: "https://checkout.stripe.com/pay/cs_test_mock_123",
          payment_intent: "pi_test_mock_123",
        }),
        retrieveCheckoutSession: vi.fn(),
        expireCheckoutSession: vi.fn(),
        retrievePaymentIntent: vi.fn(),
      };
      setStripeClient(mockStripeClient);

      vi.spyOn(paymentRepository, "findBookingForPayment").mockResolvedValue({
        id: bookingId,
        customerId,
        status: "PENDING",
        requiresApproval: false,
        paymentStatus: "UNPAID",
        currency: "USD",
        finalPrice: 120 as any,
        customer: { email: "cust@example.com", name: "Bob" } as any,
        service: { name: "Snorkeling Tour" } as any,
      } as any);

      vi.spyOn(paymentRepository, "createOrGetStripePayment").mockResolvedValue({
        payment: { id: "p-123", status: "INITIATED", amount: 120, currency: "USD" } as any,
        isAlreadyVerified: false,
        isExistingActive: false,
      });

      vi.spyOn(paymentRepository, "updatePaymentStripeSession").mockResolvedValue({} as any);

      const result = await createStripeCheckoutSession(customerId, {
        bookingId,
        successUrl: "http://localhost:3000/checkout/success?session_id={CHECKOUT_SESSION_ID}",
        cancelUrl: "http://localhost:3000/checkout/cancel",
      });

      expect(result.sessionId).toBe("cs_test_mock_123");
      expect(result.sessionUrl).toBe("https://checkout.stripe.com/pay/cs_test_mock_123");

      expect(mockStripeClient.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId,
          customerId,
          amountMinor: 12000,
          currency: "USD",
          successUrl: "http://localhost:3000/checkout/success?session_id={CHECKOUT_SESSION_ID}",
          cancelUrl: "http://localhost:3000/checkout/cancel",
        })
      );
    });

    it("handles Stripe session creation failure gracefully", async () => {
      const mockStripeClient: IStripeClient = {
        createCheckoutSession: vi.fn().mockRejectedValue(new Error("Stripe network error")),
        retrieveCheckoutSession: vi.fn(),
        expireCheckoutSession: vi.fn(),
        retrievePaymentIntent: vi.fn(),
      };
      setStripeClient(mockStripeClient);

      vi.spyOn(paymentRepository, "findBookingForPayment").mockResolvedValue({
        id: bookingId,
        customerId,
        status: "PENDING",
        requiresApproval: false,
        paymentStatus: "UNPAID",
        currency: "USD",
        finalPrice: 120 as any,
        customer: { email: "cust@example.com" } as any,
        service: { name: "Tour" } as any,
      } as any);

      vi.spyOn(paymentRepository, "createOrGetStripePayment").mockResolvedValue({
        payment: { id: "p-123", status: "INITIATED", amount: 120, currency: "USD" } as any,
        isAlreadyVerified: false,
        isExistingActive: false,
      });

      await expect(
        createStripeCheckoutSession(customerId, { bookingId })
      ).rejects.toThrow("Stripe network error");
    });
  });
});
