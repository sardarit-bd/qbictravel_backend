import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateSecureToken, hashToken } from "../../tokenUtils.js";
import * as paymentService from "../../paymentService.js";
import * as paymentRepository from "../../paymentRepository.js";
import { defaultPayPalClient } from "../../paypalClient.js";

describe("PaymentLink Unit & Security Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Token security", () => {
    it("generates a 64-character hexadecimal secure random token", () => {
      const token1 = generateSecureToken();
      const token2 = generateSecureToken();

      expect(token1).toHaveLength(64);
      expect(token2).toHaveLength(64);
      expect(token1).not.toBe(token2);
      expect(/^[0-9a-f]{64}$/.test(token1)).toBe(true);
    });

    it("generates consistent SHA-256 hashes", () => {
      const token = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
      expect(hash1).not.toBe(token);
    });
  });

  describe("Agent Payment Link Generation", () => {
    it("rejects payment link generation if booking belongs to another agent", async () => {
      vi.spyOn(paymentRepository, "findBookingForPayment").mockResolvedValue({
        id: "booking-123",
        customerId: "cust-1",
        agentId: "agent-other",
        status: "PENDING",
        requiresApproval: false,
        paymentStatus: "UNPAID",
        currency: "USD",
        finalPrice: 150 as any,
      } as any);

      await expect(
        paymentService.generateAgentPaymentLink("agent-mine", "booking-123"),
      ).rejects.toThrow("You can only generate payment links for your own bookings");
    });

    it("rejects payment link generation if booking is already paid in full", async () => {
      vi.spyOn(paymentRepository, "findBookingForPayment").mockResolvedValue({
        id: "booking-123",
        customerId: "cust-1",
        agentId: "agent-mine",
        status: "CONFIRMED",
        requiresApproval: false,
        paymentStatus: "PAID",
        currency: "USD",
        finalPrice: 150 as any,
      } as any);

      await expect(
        paymentService.generateAgentPaymentLink("agent-mine", "booking-123"),
      ).rejects.toThrow("This booking is already paid in full");
    });

    it("successfully creates a payment link with url for active booking", async () => {
      vi.spyOn(paymentRepository, "findBookingForPayment").mockResolvedValue({
        id: "booking-123",
        customerId: "cust-1",
        agentId: "agent-mine",
        status: "PENDING",
        requiresApproval: false,
        paymentStatus: "UNPAID",
        currency: "USD",
        finalPrice: 150 as any,
      } as any);

      const fakeLink = {
        id: "link-abc",
        bookingId: "booking-123",
        tokenHash: "hashed",
        expiresAt: new Date(Date.now() + 86400000),
        status: "ACTIVE",
        createdById: "agent-mine",
      };

      vi.spyOn(paymentRepository, "createOrUpdatePaymentLink").mockResolvedValue(fakeLink as any);

      const result = await paymentService.generateAgentPaymentLink("agent-mine", "booking-123");

      expect(result.bookingId).toBe("booking-123");
      expect(result.rawToken).toHaveLength(64);
      expect(result.paymentUrl).toContain(`/pay/${result.rawToken}`);
      expect(result.status).toBe("ACTIVE");
    });
  });

  describe("Public Link Details Security & Privacy", () => {
    it("masks customer email and computes remaining balance correctly", async () => {
      const token = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
      const tokenHash = hashToken(token);

      vi.spyOn(paymentRepository, "findPaymentLinkByTokenHash").mockResolvedValue({
        id: "link-1",
        bookingId: "b-1",
        tokenHash,
        expiresAt: new Date(Date.now() + 86400000),
        status: "ACTIVE",
        booking: {
          id: "b-1",
          status: "PENDING",
          paymentStatus: "PARTIALLY_PAID",
          currency: "USD",
          finalPrice: 200 as any,
          service: {
            id: "s-1",
            name: "Phi Phi Island Day Trip",
            description: "Beautiful boat trip",
          },
          customer: {
            id: "c-1",
            name: "John Doe",
            email: "johndoe@example.com",
            phone: "+66812345678",
          },
          availability: {
            date: new Date("2026-12-01"),
          },
          payments: [
            {
              id: "p-1",
              amount: 50 as any,
              currency: "USD",
              status: "VERIFIED",
              method: "STRIPE",
            },
          ],
        },
      } as any);

      const details = await paymentService.getPublicPaymentLinkDetails(token);

      expect(details.tourTitle).toBe("Phi Phi Island Day Trip");
      expect(details.customerName).toBe("John Doe");
      expect(details.customerEmailMasked).toBe("j***e@example.com");
      expect(details.totalAmount).toBe(200);
      expect(details.paidAmount).toBe(50);
      expect(details.remainingBalance).toBe(150);
      expect(details.isPayable).toBe(true);
      expect(details.linkStatus).toBe("ACTIVE");
    });

    it("marks link as EXPIRED if past expiration date", async () => {
      const token = "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3";
      const pastDate = new Date(Date.now() - 3600000);

      vi.spyOn(paymentRepository, "findPaymentLinkByTokenHash").mockResolvedValue({
        id: "link-expired",
        bookingId: "b-2",
        tokenHash: hashToken(token),
        expiresAt: pastDate,
        status: "ACTIVE",
        booking: {
          id: "b-2",
          status: "PENDING",
          paymentStatus: "UNPAID",
          currency: "USD",
          finalPrice: 100 as any,
          service: { id: "s-2", name: "Sunset Cruise", description: null },
          customer: { id: "c-2", name: "Alice", email: "alice@test.com" },
          payments: [],
        },
      } as any);

      const details = await paymentService.getPublicPaymentLinkDetails(token);

      expect(details.linkStatus).toBe("EXPIRED");
      expect(details.isPayable).toBe(false);
    });
  });

  describe("PayPal Graceful Degradation", () => {
    it("reports paypalAvailable as false when credentials are empty", () => {
      const originalClientId = process.env.PAYPAL_CLIENT_ID;
      const originalClientSecret = process.env.PAYPAL_CLIENT_SECRET;
      delete process.env.PAYPAL_CLIENT_ID;
      delete process.env.PAYPAL_CLIENT_SECRET;

      expect(defaultPayPalClient.isAvailable()).toBe(false);

      if (originalClientId) process.env.PAYPAL_CLIENT_ID = originalClientId;
      if (originalClientSecret) process.env.PAYPAL_CLIENT_SECRET = originalClientSecret;
    });

    it("throws 503 if trying to create PayPal order when client is not available", async () => {
      vi.spyOn(defaultPayPalClient, "isAvailable").mockReturnValue(false);

      await expect(
        paymentService.createPublicPayPalOrder("some-token"),
      ).rejects.toThrow("PayPal is not currently configured on this platform");
    });
  });
});

