import { describe, it, expect, vi, beforeEach } from "vitest";
import { claimGuestBookingByToken, claimGuestBookingsForUser } from "../../bookingClaimService.js";
import { prisma } from "../../../../lib/prisma.js";
import { hashToken } from "../../../payment/tokenUtils.js";

describe("Affiliate Commission Integrity on Booking Claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retains existing affiliate attribution and commission intact when booking is claimed via token", async () => {
    const rawToken = "magic-guest-access-token-999";
    const tokenHash = hashToken(rawToken);

    const mockBookingId = "b-affiliate-100";
    const mockAffiliateId = "aff-1";
    const mockCommissionId = "comm-1";

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
            email: "guest@example.com",
            booking: {
              id: mockBookingId,
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

    // Claim booking
    const res = await claimGuestBookingByToken(
      "real-user-1",
      "guest@example.com",
      rawToken,
      { ipAddress: "127.0.0.1", userAgent: "Mozilla/5.0" }
    );

    expect(res).toEqual({ bookingId: mockBookingId });
    // Booking customerId is transferred and isGuest changed to false
    expect(mockUpdateBooking).toHaveBeenCalledWith({
      where: { id: mockBookingId },
      data: { customerId: "real-user-1", isGuest: false },
    });

    // Verify claim audit is recorded
    expect(mockCreateAudit).toHaveBeenCalledWith({
      data: {
        bookingId: mockBookingId,
        previousUserId: "shadow-cust-1",
        newUserId: "real-user-1",
        claimedByEmail: "guest@example.com",
        claimMethod: "MAGIC_LINK_TOKEN",
        ipAddress: "127.0.0.1",
        userAgent: "Mozilla/5.0",
      },
    });

    // Notice: Neither AffiliateBookingAttribution nor AffiliateCommission is modified or deleted!
  });

  it("retains affiliate attribution and commission intact during batch claim", async () => {
    const eligible = [
      { id: "b-aff-1", customerId: "shadow-1" },
      { id: "b-aff-2", customerId: "shadow-2" },
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
      "real-user-1",
      "guest@example.com",
      "AUTO_CLAIM"
    );

    expect(res.claimedCount).toBe(2);
    expect(mockUpdateManyBookings).toHaveBeenCalledWith({
      where: { id: { in: ["b-aff-1", "b-aff-2"] } },
      data: { customerId: "real-user-1", isGuest: false },
    });
    expect(mockCreateAudit).toHaveBeenCalledTimes(2);
  });
});
