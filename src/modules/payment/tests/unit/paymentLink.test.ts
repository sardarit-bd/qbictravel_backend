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

  describe("Staff Payment Link Generation", () => {
    it("allows staff who created the booking to generate a payment link once confirmed", async () => {
      vi.spyOn(paymentRepository, "findBookingForPayment").mockResolvedValue({
        id: "booking-staff-1",
        customerId: "cust-1",
        createdById: "staff-1",
        assignedStaffId: null,
        agentId: null,
        status: "CONFIRMED",
        requiresApproval: false,
        paymentStatus: "UNPAID",
        currency: "USD",
        finalPrice: 180 as any,
      } as any);

      const fakeLink = {
        id: "link-staff-1",
        bookingId: "booking-staff-1",
        tokenHash: "hashed-token",
        expiresAt: new Date(Date.now() + 86400000 * 7),
        status: "ACTIVE",
        createdById: "staff-1",
      };

      vi.spyOn(paymentRepository, "createOrUpdatePaymentLink").mockResolvedValue(fakeLink as any);

      const result = await paymentService.generateStaffPaymentLink(
        { id: "staff-1", role: "staff" },
        "booking-staff-1"
      );

      expect(result.bookingId).toBe("booking-staff-1");
      expect(result.rawToken).toHaveLength(64);
      expect(result.paymentUrl).toContain(`/pay/${result.rawToken}`);
      expect(paymentRepository.createOrUpdatePaymentLink).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: "booking-staff-1",
          createdById: "staff-1",
        })
      );
    });

    it("allows assigned operational staff to generate a payment link", async () => {
      vi.spyOn(paymentRepository, "findBookingForPayment").mockResolvedValue({
        id: "booking-staff-2",
        customerId: "cust-1",
        createdById: "other-staff",
        assignedStaffId: "staff-assigned",
        agentId: null,
        status: "CONFIRMED",
        requiresApproval: false,
        paymentStatus: "UNPAID",
        currency: "USD",
        finalPrice: 200 as any,
      } as any);

      const fakeLink = {
        id: "link-staff-2",
        bookingId: "booking-staff-2",
        tokenHash: "hashed-token-2",
        expiresAt: new Date(Date.now() + 86400000 * 7),
        status: "ACTIVE",
        createdById: "staff-assigned",
      };

      vi.spyOn(paymentRepository, "createOrUpdatePaymentLink").mockResolvedValue(fakeLink as any);

      const result = await paymentService.generateStaffPaymentLink(
        { id: "staff-assigned", role: "staff" },
        "booking-staff-2"
      );

      expect(result.bookingId).toBe("booking-staff-2");
      expect(result.paymentUrl).toContain(`/pay/${result.rawToken}`);
    });

    it("allows admin user to generate a payment link for any confirmed booking", async () => {
      vi.spyOn(paymentRepository, "findBookingForPayment").mockResolvedValue({
        id: "booking-admin-1",
        customerId: "cust-1",
        createdById: "random-staff",
        assignedStaffId: "another-staff",
        agentId: null,
        status: "CONFIRMED",
        requiresApproval: false,
        paymentStatus: "UNPAID",
        currency: "USD",
        finalPrice: 300 as any,
      } as any);

      const fakeLink = {
        id: "link-admin-1",
        bookingId: "booking-admin-1",
        tokenHash: "hashed-admin",
        expiresAt: new Date(Date.now() + 86400000 * 7),
        status: "ACTIVE",
        createdById: "admin-1",
      };

      vi.spyOn(paymentRepository, "createOrUpdatePaymentLink").mockResolvedValue(fakeLink as any);

      const result = await paymentService.generateStaffPaymentLink(
        { id: "admin-1", role: "admin" },
        "booking-admin-1"
      );

      expect(result.bookingId).toBe("booking-admin-1");
      expect(result.paymentUrl).toContain(`/pay/${result.rawToken}`);
    });

    it("rejects unauthorized staff who is neither creator nor assigned", async () => {
      vi.spyOn(paymentRepository, "findBookingForPayment").mockResolvedValue({
        id: "booking-staff-3",
        customerId: "cust-1",
        createdById: "staff-creator",
        assignedStaffId: "staff-assigned",
        agentId: null,
        status: "CONFIRMED",
        requiresApproval: false,
        paymentStatus: "UNPAID",
        currency: "USD",
        finalPrice: 150 as any,
      } as any);

      await expect(
        paymentService.generateStaffPaymentLink(
          { id: "staff-unrelated", role: "staff" },
          "booking-staff-3"
        )
      ).rejects.toThrow("You are not authorized to generate a payment link for this booking");
    });

    it("rejects payment link generation if booking is awaiting admin approval with discount", async () => {
      vi.spyOn(paymentRepository, "findBookingForPayment").mockResolvedValue({
        id: "booking-staff-awaiting",
        createdById: "staff-1",
        status: "AWAITING_APPROVAL",
        requiresApproval: true,
        paymentStatus: "UNPAID",
        currency: "USD",
        finalPrice: 150 as any,
      } as any);

      await expect(
        paymentService.generateStaffPaymentLink(
          { id: "staff-1", role: "staff" },
          "booking-staff-awaiting"
        )
      ).rejects.toThrow("Cannot create a payment link while booking is awaiting admin approval");
    });

    it("rejects payment link generation if booking is pending admin approval without discount", async () => {
      vi.spyOn(paymentRepository, "findBookingForPayment").mockResolvedValue({
        id: "booking-staff-pending-no-discount",
        createdById: "staff-1",
        status: "PENDING",
        requiresApproval: false,
        paymentStatus: "UNPAID",
        currency: "USD",
        finalPrice: 150 as any,
      } as any);

      await expect(
        paymentService.generateStaffPaymentLink(
          { id: "staff-1", role: "staff" },
          "booking-staff-pending-no-discount"
        )
      ).rejects.toThrow("Cannot create a payment link while booking is awaiting admin approval");
    });

    it("rejects payment link generation if booking has a pending discount request", async () => {
      vi.spyOn(paymentRepository, "findBookingForPayment").mockResolvedValue({
        id: "booking-staff-pending-discount",
        createdById: "staff-1",
        status: "CONFIRMED",
        requiresApproval: false,
        paymentStatus: "UNPAID",
        currency: "THB",
        finalPrice: 12578 as any,
        discountRequests: [{ id: "dr-pending", status: "PENDING" }],
      } as any);

      await expect(
        paymentService.generateStaffPaymentLink(
          { id: "staff-1", role: "staff" },
          "booking-staff-pending-discount"
        )
      ).rejects.toThrow("Cannot create a payment link while booking is awaiting admin approval");
    });

    it("verifies payment link uses persisted approved finalPrice (e.g. THB 12,578 for 5% approved)", async () => {
      vi.spyOn(paymentRepository, "findBookingForPayment").mockResolvedValue({
        id: "booking-staff-approved-5pct",
        createdById: "staff-1",
        status: "CONFIRMED",
        requiresApproval: false,
        paymentStatus: "UNPAID",
        currency: "THB",
        finalPrice: 12578 as any, // 13,240 base - 5% discount (662) = 12,578
        discountRequests: [],
      } as any);

      const fakeLink = {
        id: "link-approved-5pct",
        bookingId: "booking-staff-approved-5pct",
        tokenHash: "hashed-token-5pct",
        expiresAt: new Date(Date.now() + 86400000 * 7),
        status: "ACTIVE",
      };
      vi.spyOn(paymentRepository, "createOrUpdatePaymentLink").mockResolvedValue(fakeLink as any);

      const result = await paymentService.generateStaffPaymentLink(
        { id: "staff-1", role: "staff" },
        "booking-staff-approved-5pct"
      );

      expect(result.bookingId).toBe("booking-staff-approved-5pct");
      expect(result.paymentUrl).toContain(`/pay/${result.rawToken}`);
    });

    it("rejects payment link generation if booking is already paid", async () => {
      vi.spyOn(paymentRepository, "findBookingForPayment").mockResolvedValue({
        id: "booking-staff-4",
        createdById: "staff-1",
        status: "CONFIRMED",
        requiresApproval: false,
        paymentStatus: "PAID",
        currency: "USD",
        finalPrice: 150 as any,
      } as any);

      await expect(
        paymentService.generateStaffPaymentLink(
          { id: "staff-1", role: "staff" },
          "booking-staff-4"
        )
      ).rejects.toThrow("This booking is already paid in full");
    });

    it("rejects payment link generation if booking is cancelled", async () => {
      vi.spyOn(paymentRepository, "findBookingForPayment").mockResolvedValue({
        id: "booking-staff-5",
        createdById: "staff-1",
        status: "CANCELLED",
        requiresApproval: false,
        paymentStatus: "UNPAID",
        currency: "USD",
        finalPrice: 150 as any,
      } as any);

      await expect(
        paymentService.generateStaffPaymentLink(
          { id: "staff-1", role: "staff" },
          "booking-staff-5"
        )
      ).rejects.toThrow("Cannot create a payment link for a cancelled booking");
    });

    it("rejects payment link generation if booking has invalid price or currency", async () => {
      vi.spyOn(paymentRepository, "findBookingForPayment").mockResolvedValue({
        id: "booking-staff-6",
        createdById: "staff-1",
        status: "CONFIRMED",
        requiresApproval: false,
        paymentStatus: "UNPAID",
        currency: "",
        finalPrice: 0 as any,
      } as any);

      await expect(
        paymentService.generateStaffPaymentLink(
          { id: "staff-1", role: "staff" },
          "booking-staff-6"
        )
      ).rejects.toThrow("Booking has invalid pricing or currency");
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

