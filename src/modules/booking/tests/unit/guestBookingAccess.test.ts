import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../../../../lib/prisma.js";
import * as bookingService from "../../bookingService.js";
import * as bookingRepository from "../../bookingRepository.js";
import { hashToken } from "../../../payment/tokenUtils.js";
import AppError from "../../../../shared/utils/AppError.js";

describe("Phase 6: Guest Booking Access & Secure Magic Link Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const rawValidToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const validTokenHash = hashToken(rawValidToken);

  const mockBooking = {
    id: "booking-guest-1234",
    status: "CONFIRMED",
    paymentStatus: "PAID",
    fulfillmentStatus: "NOT_STARTED",
    currency: "THB",
    basePrice: 4000,
    finalPrice: 3600,
    notes: "Travel Date: 2026-12-25 | Guests: 2 Adults, 1 Child | Please prepare vegetarian lunch",
    createdAt: new Date("2026-11-19T10:00:00Z"),
    service: {
      id: "srv-phi-phi",
      name: "Phi Phi Islands Luxury Catamaran",
      type: "TOUR",
      description: "Full day island cruise with lunch and snorkeling equipment.",
      providerName: "Andaman Marine Tours",
      metadata: { highlight: "Snorkeling" },
    },
    availability: {
      date: new Date("2026-12-25"),
    },
    guestSnapshot: {
      guestName: "Alice Wonderland",
      guestEmail: "alice@example.com",
      guestPhone: "+66812345678",
    },
    paymentLinks: [
      {
        tokenHash: "payment-hash-active",
        expiresAt: new Date(Date.now() + 86400000 * 5),
        status: "ACTIVE",
      },
    ],
    payments: [
      {
        id: "pay-1",
        amount: 3600,
        currency: "THB",
        method: "STRIPE",
        status: "VERIFIED",
        createdAt: new Date("2026-11-19T10:05:00Z"),
      },
    ],
  };

  describe("1. Magic Link Token Validation", () => {
    it("successfully retrieves safe sanitized itinerary for valid token", async () => {
      const mockTokenRecord = {
        id: "tok-1",
        bookingId: "booking-guest-1234",
        tokenHash: validTokenHash,
        email: "alice@example.com",
        purpose: "ACCESS_AND_CLAIM",
        expiresAt: new Date(Date.now() + 86400000 * 20), // 20 days remaining
        revokedAt: null,
        usedAt: null,
        booking: mockBooking,
      };

      vi.spyOn(bookingRepository, "findGuestBookingTokenByHash").mockResolvedValue(mockTokenRecord as any);

      const result = await bookingService.getPublicGuestBookingDetails(rawValidToken);

      expect(result.bookingReference).toBe("BOOKING-");
      expect(result.guest.name).toBe("Alice Wonderland");
      expect(result.guest.email).toBe("alice@example.com");
      expect(result.guest.party).toEqual({ adults: 2, children: 1, infants: 0 });
      expect(result.service.name).toBe("Phi Phi Islands Luxury Catamaran");
      expect(result.travelDate).toBe("2026-12-25");
      expect(result.pricing.finalPrice).toBe(3600);
      expect(result.pricing.totalPaid).toBe(3600);
      expect(result.pricing.remainingBalance).toBe(0);

      // Verify cancellation policy enforcement: support-only
      expect(result.cancellationPolicy.allowed).toBe(false);
      expect(result.cancellationPolicy.supportEmail).toBe("support@phukettours.com");

      // Verify no sensitive internal customer IDs or private notes
      expect((result as any).customerId).toBeUndefined();
      expect((result as any).internalNotes).toBeUndefined();
      expect((result as any).tokenHash).toBeUndefined();
    });

    it("throws 404 generic error when token does not exist in database (tampered or wrong token)", async () => {
      vi.spyOn(bookingRepository, "findGuestBookingTokenByHash").mockResolvedValue(null);

      await expect(bookingService.getPublicGuestBookingDetails("unknown-tampered-token-abc")).rejects.toThrow(
        new AppError("Invalid or expired booking access link", 404),
      );
    });

    it("throws 410 error when token is past its expiration date", async () => {
      const mockExpiredRecord = {
        id: "tok-expired",
        bookingId: "booking-guest-1234",
        tokenHash: validTokenHash,
        email: "alice@example.com",
        purpose: "ACCESS_AND_CLAIM",
        expiresAt: new Date(Date.now() - 1000), // expired 1s ago
        revokedAt: null,
        usedAt: null,
        booking: mockBooking,
      };

      vi.spyOn(bookingRepository, "findGuestBookingTokenByHash").mockResolvedValue(mockExpiredRecord as any);

      await expect(bookingService.getPublicGuestBookingDetails(rawValidToken)).rejects.toThrow(
        new AppError("This booking access link has expired", 410),
      );
    });

    it("throws 403 error when token has been revoked", async () => {
      const mockRevokedRecord = {
        id: "tok-revoked",
        bookingId: "booking-guest-1234",
        tokenHash: validTokenHash,
        email: "alice@example.com",
        purpose: "ACCESS_AND_CLAIM",
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: new Date(Date.now() - 5000), // revoked 5s ago
        usedAt: null,
        booking: mockBooking,
      };

      vi.spyOn(bookingRepository, "findGuestBookingTokenByHash").mockResolvedValue(mockRevokedRecord as any);

      await expect(bookingService.getPublicGuestBookingDetails(rawValidToken)).rejects.toThrow(
        new AppError("This booking access link has been revoked", 403),
      );
    });
  });

  describe("2. Payment Status & Action in Guest Itinerary", () => {
    it("provides payment action when balance remains due and payment link is active", async () => {
      const mockUnpaidBooking = {
        ...mockBooking,
        paymentStatus: "UNPAID",
        status: "PENDING",
        payments: [],
        paymentLinks: [
          {
            tokenHash: "raw-pay-hash-1234",
            expiresAt: new Date(Date.now() + 86400000 * 3),
            status: "ACTIVE",
          },
        ],
      };

      const mockTokenRecord = {
        id: "tok-unpaid",
        bookingId: "booking-guest-1234",
        tokenHash: validTokenHash,
        email: "alice@example.com",
        purpose: "ACCESS_AND_CLAIM",
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null,
        usedAt: null,
        booking: mockUnpaidBooking,
      };

      vi.spyOn(bookingRepository, "findGuestBookingTokenByHash").mockResolvedValue(mockTokenRecord as any);

      const result = await bookingService.getPublicGuestBookingDetails(rawValidToken);

      expect(result.pricing.remainingBalance).toBe(3600);
      expect(result.paymentAction.isPayable).toBe(true);
      expect(result.paymentAction.paymentUrl).toContain("/pay/raw-pay-hash-1234");
    });

    it("disables payment action when payment link has expired", async () => {
      const mockExpiredPaymentBooking = {
        ...mockBooking,
        paymentStatus: "UNPAID",
        status: "PENDING",
        payments: [],
        paymentLinks: [
          {
            tokenHash: "raw-pay-hash-expired",
            expiresAt: new Date(Date.now() - 10000), // expired payment link
            status: "ACTIVE",
          },
        ],
      };

      const mockTokenRecord = {
        id: "tok-expired-pay",
        bookingId: "booking-guest-1234",
        tokenHash: validTokenHash,
        email: "alice@example.com",
        purpose: "ACCESS_AND_CLAIM",
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null,
        usedAt: null,
        booking: mockExpiredPaymentBooking,
      };

      vi.spyOn(bookingRepository, "findGuestBookingTokenByHash").mockResolvedValue(mockTokenRecord as any);

      const result = await bookingService.getPublicGuestBookingDetails(rawValidToken);

      expect(result.paymentAction.isPayable).toBe(false);
      expect(result.pricing.remainingBalance).toBe(3600);
    });
  });
});
