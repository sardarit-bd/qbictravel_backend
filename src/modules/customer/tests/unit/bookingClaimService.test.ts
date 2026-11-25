import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  claimGuestBookingByToken,
  claimGuestBookingsForUser,
  findUnclaimedGuestBookingsByEmail,
  isBookingEligibleForClaim,
} from "../../bookingClaimService.js";
import { prisma } from "../../../../lib/prisma.js";
import { hashToken } from "../../../payment/tokenUtils.js";
import AppError from "../../../../shared/utils/AppError.js";

describe("bookingClaimService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isBookingEligibleForClaim", () => {
    it("returns true for a genuine unclaimed guest booking", () => {
      const booking = {
        isGuest: true,
        agentId: null,
        createdById: null,
        customerId: "shadow-cust-123",
      };
      expect(isBookingEligibleForClaim(booking, "real-user-456")).toBe(true);
    });

    it("returns false if isGuest is false", () => {
      const booking = {
        isGuest: false,
        agentId: null,
        createdById: null,
        customerId: "shadow-cust-123",
      };
      expect(isBookingEligibleForClaim(booking, "real-user-456")).toBe(false);
    });

    it("returns false if created by staff/admin (createdById != null)", () => {
      const booking = {
        isGuest: true,
        agentId: null,
        createdById: "staff-999",
        customerId: "shadow-cust-123",
      };
      expect(isBookingEligibleForClaim(booking, "real-user-456")).toBe(false);
    });

    it("returns false if agent-managed (agentId != null)", () => {
      const booking = {
        isGuest: true,
        agentId: "agent-777",
        createdById: null,
        customerId: "shadow-cust-123",
      };
      expect(isBookingEligibleForClaim(booking, "real-user-456")).toBe(false);
    });

    it("returns false if already owned by target user", () => {
      const booking = {
        isGuest: true,
        agentId: null,
        createdById: null,
        customerId: "real-user-456",
      };
      expect(isBookingEligibleForClaim(booking, "real-user-456")).toBe(false);
    });
  });

  describe("claimGuestBookingByToken", () => {
    const rawToken = "magic-guest-access-token-12345";
    const tokenHash = hashToken(rawToken);

    it("throws 400 if token is missing or empty", async () => {
      await expect(
        claimGuestBookingByToken("user-1", "user@example.com", "")
      ).rejects.toThrow(new AppError("Access token is required to claim booking", 400));
    });

    it("throws 404 if token record not found", async () => {
      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        return callback({
          guestBookingToken: {
            findUnique: vi.fn().mockResolvedValue(null),
          },
        });
      });

      await expect(
        claimGuestBookingByToken("user-1", "user@example.com", rawToken)
      ).rejects.toThrow(new AppError("Invalid or expired booking access token", 404));
    });

    it("throws 403 if token has been revoked", async () => {
      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        return callback({
          guestBookingToken: {
            findUnique: vi.fn().mockResolvedValue({
              tokenHash,
              revokedAt: new Date(),
              expiresAt: new Date(Date.now() + 86400000),
              email: "user@example.com",
              booking: { id: "b-1", isGuest: true, customerId: "shadow-1" },
            }),
          },
        });
      });

      await expect(
        claimGuestBookingByToken("user-1", "user@example.com", rawToken)
      ).rejects.toThrow(new AppError("This booking access token has been revoked", 403));
    });

    it("throws 410 if token is expired", async () => {
      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        return callback({
          guestBookingToken: {
            findUnique: vi.fn().mockResolvedValue({
              tokenHash,
              revokedAt: null,
              expiresAt: new Date(Date.now() - 1000),
              email: "user@example.com",
              booking: { id: "b-1", isGuest: true, customerId: "shadow-1" },
            }),
          },
        });
      });

      await expect(
        claimGuestBookingByToken("user-1", "user@example.com", rawToken)
      ).rejects.toThrow(new AppError("This booking access token has expired", 410));
    });

    it("throws 403 if token email does not match user email", async () => {
      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        return callback({
          guestBookingToken: {
            findUnique: vi.fn().mockResolvedValue({
              tokenHash,
              revokedAt: null,
              expiresAt: new Date(Date.now() + 86400000),
              email: "different@example.com",
              booking: { id: "b-1", isGuest: true, customerId: "shadow-1" },
            }),
          },
        });
      });

      await expect(
        claimGuestBookingByToken("user-1", "user@example.com", rawToken)
      ).rejects.toThrow(
        new AppError(
          "You can only claim bookings associated with your verified account email",
          403
        )
      );
    });

    it("successfully claims booking and writes BookingClaimAudit", async () => {
      const mockUpdateBooking = vi.fn().mockResolvedValue({});
      const mockUpdateToken = vi.fn().mockResolvedValue({});
      const mockCreateAudit = vi.fn().mockResolvedValue({});

      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        return callback({
          guestBookingToken: {
            findUnique: vi.fn().mockResolvedValue({
              id: "token-row-1",
              tokenHash,
              revokedAt: null,
              expiresAt: new Date(Date.now() + 86400000),
              email: "user@example.com",
              booking: {
                id: "b-100",
                isGuest: true,
                customerId: "shadow-cust-1",
                agentId: null,
                createdById: null,
              },
            }),
            update: mockUpdateToken,
          },
          booking: {
            update: mockUpdateBooking,
          },
          bookingClaimAudit: {
            create: mockCreateAudit,
          },
        });
      });

      const res = await claimGuestBookingByToken(
        "user-real-1",
        "user@example.com",
        rawToken,
        { ipAddress: "127.0.0.1", userAgent: "Mozilla/5.0" }
      );

      expect(res).toEqual({ bookingId: "b-100" });
      expect(mockUpdateBooking).toHaveBeenCalledWith({
        where: { id: "b-100" },
        data: { customerId: "user-real-1", isGuest: false },
      });
      expect(mockUpdateToken).toHaveBeenCalledWith({
        where: { id: "token-row-1" },
        data: { usedAt: expect.any(Date) },
      });
      expect(mockCreateAudit).toHaveBeenCalledWith({
        data: {
          bookingId: "b-100",
          previousUserId: "shadow-cust-1",
          newUserId: "user-real-1",
          claimedByEmail: "user@example.com",
          claimMethod: "MAGIC_LINK_TOKEN",
          ipAddress: "127.0.0.1",
          userAgent: "Mozilla/5.0",
        },
      });
    });
  });

  describe("claimGuestBookingsForUser", () => {
    it("returns 0 claimedCount if no eligible bookings exist", async () => {
      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        return callback({
          booking: {
            findMany: vi.fn().mockResolvedValue([]),
          },
        });
      });

      const res = await claimGuestBookingsForUser("user-real-1", "user@example.com");
      expect(res).toEqual({ claimedCount: 0, bookingIds: [] });
    });

    it("claims all eligible bookings and creates audit logs atomically", async () => {
      const eligible = [
        { id: "b-1", customerId: "shadow-1" },
        { id: "b-2", customerId: "shadow-2" },
      ];
      const mockUpdateManyBookings = vi.fn().mockResolvedValue({ count: 2 });
      const mockUpdateManyTokens = vi.fn().mockResolvedValue({ count: 2 });
      const mockCreateAudit = vi.fn().mockResolvedValue({});

      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        return callback({
          booking: {
            findMany: vi.fn().mockResolvedValue(eligible),
            updateMany: mockUpdateManyBookings,
          },
          guestBookingToken: {
            updateMany: mockUpdateManyTokens,
          },
          bookingClaimAudit: {
            create: mockCreateAudit,
          },
        });
      });

      const res = await claimGuestBookingsForUser(
        "user-real-1",
        "user@example.com",
        "EMAIL_VERIFICATION",
        { ipAddress: "192.168.1.1", userAgent: "TestAgent" }
      );

      expect(res.claimedCount).toBe(2);
      expect(res.bookingIds).toEqual(["b-1", "b-2"]);
      expect(mockUpdateManyBookings).toHaveBeenCalledWith({
        where: { id: { in: ["b-1", "b-2"] } },
        data: { customerId: "user-real-1", isGuest: false },
      });
      expect(mockCreateAudit).toHaveBeenCalledTimes(2);
    });
  });
});
