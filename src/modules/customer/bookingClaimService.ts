import { prisma } from "../../lib/prisma.js";
import AppError from "../../shared/utils/AppError.js";
import { hashToken } from "../payment/tokenUtils.js";
import logger from "../../shared/logger/logger.js";

export interface ClaimContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface ClaimBookingResult {
  claimedCount: number;
  bookingIds: string[];
}

/**
 * Validates that an unclaimed guest booking is eligible for claiming.
 * A booking is eligible if:
 * 1. isGuest === true
 * 2. agentId is null (not an agent-managed or partner portal booking)
 * 3. createdById is null (not created on behalf of someone by staff/admin)
 * 4. customerId !== targetUserId (not already claimed by this user)
 */
export const isBookingEligibleForClaim = (booking: {
  isGuest: boolean;
  agentId?: string | null;
  createdById?: string | null;
  customerId: string;
}, targetUserId: string): boolean => {
  return (
    booking.isGuest === true &&
    !booking.agentId &&
    !booking.createdById &&
    booking.customerId !== targetUserId
  );
};

/**
 * Claims a guest booking using a valid, unexpired GuestBookingToken (Magic Link).
 * The authenticated user's email must match the guest booking token's email (case-insensitive).
 */
export const claimGuestBookingByToken = async (
  userId: string,
  userEmail: string,
  rawToken: string,
  context: ClaimContext = {}
): Promise<{ bookingId: string }> => {
  if (!rawToken || typeof rawToken !== "string" || !rawToken.trim()) {
    throw new AppError("Access token is required to claim booking", 400);
  }

  const normalizedUserEmail = userEmail.trim().toLowerCase();
  const tokenHash = hashToken(rawToken.trim());

  return await prisma.$transaction(async (tx) => {
    // 1. Find the token
    const tokenRecord = await tx.guestBookingToken.findUnique({
      where: { tokenHash },
      include: {
        booking: {
          include: {
            guestSnapshot: true,
          },
        },
      },
    });

    if (!tokenRecord) {
      throw new AppError("Invalid or expired booking access token", 404);
    }

    if (tokenRecord.revokedAt) {
      throw new AppError("This booking access token has been revoked", 403);
    }

    if (new Date() > new Date(tokenRecord.expiresAt)) {
      throw new AppError("This booking access token has expired", 410);
    }

    const booking = tokenRecord.booking;
    if (!booking) {
      throw new AppError("Associated booking not found", 404);
    }

    // Verify token email matches logged-in user email
    if (tokenRecord.email.trim().toLowerCase() !== normalizedUserEmail) {
      throw new AppError(
        "You can only claim bookings associated with your verified account email",
        403
      );
    }

    // Check if already claimed by this user
    if (booking.customerId === userId && !booking.isGuest) {
      return { bookingId: booking.id };
    }

    if (!isBookingEligibleForClaim(booking, userId)) {
      throw new AppError("This booking is not eligible to be claimed", 400);
    }

    const previousUserId = booking.customerId;

    // 2. Transfer booking ownership to target user and mark isGuest = false
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        customerId: userId,
        isGuest: false,
      },
    });

    // 3. Mark token as used
    await tx.guestBookingToken.update({
      where: { id: tokenRecord.id },
      data: {
        usedAt: new Date(),
      },
    });

    // 4. Create immutable audit record
    await tx.bookingClaimAudit.create({
      data: {
        bookingId: booking.id,
        previousUserId,
        newUserId: userId,
        claimedByEmail: normalizedUserEmail,
        claimMethod: "MAGIC_LINK_TOKEN",
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      },
    });

    logger.info(
      {
        bookingId: booking.id,
        previousUserId,
        newUserId: userId,
        claimedByEmail: normalizedUserEmail,
        method: "MAGIC_LINK_TOKEN",
      },
      "Guest booking successfully claimed via token"
    );

    return { bookingId: booking.id };
  });
};

/**
 * Finds all unclaimed guest bookings matching the given email.
 */
export const findUnclaimedGuestBookingsByEmail = async (
  email: string,
  excludeUserId?: string
) => {
  const normalizedEmail = email.trim().toLowerCase();

  const bookings = await prisma.booking.findMany({
    where: {
      isGuest: true,
      agentId: null,
      createdById: null,
      ...(excludeUserId ? { customerId: { not: excludeUserId } } : {}),
      guestSnapshot: {
        guestEmail: {
          equals: normalizedEmail,
          mode: "insensitive",
        },
      },
    },
    include: {
      service: {
        select: {
          id: true,
          name: true,
          type: true,
        },
      },
      guestSnapshot: true,
      availability: {
        select: {
          date: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return bookings;
};

/**
 * Claims all eligible unclaimed guest bookings matching a verified user's email.
 * Executed atomically in a single transaction.
 */
export const claimGuestBookingsForUser = async (
  userId: string,
  userEmail: string,
  claimMethod: "EMAIL_VERIFICATION" | "AUTO_CLAIM" | "MANUAL_BATCH" = "AUTO_CLAIM",
  context: ClaimContext = {}
): Promise<ClaimBookingResult> => {
  const normalizedEmail = userEmail.trim().toLowerCase();

  return await prisma.$transaction(async (tx) => {
    // 1. Find all eligible guest bookings
    const eligibleBookings = await tx.booking.findMany({
      where: {
        isGuest: true,
        agentId: null,
        createdById: null,
        customerId: { not: userId },
        guestSnapshot: {
          guestEmail: {
            equals: normalizedEmail,
            mode: "insensitive",
          },
        },
      },
      select: {
        id: true,
        customerId: true,
      },
    });

    if (eligibleBookings.length === 0) {
      return { claimedCount: 0, bookingIds: [] };
    }

    const bookingIds = eligibleBookings.map((b) => b.id);

    // 2. Update all eligible bookings to new customerId and isGuest = false
    await tx.booking.updateMany({
      where: {
        id: { in: bookingIds },
      },
      data: {
        customerId: userId,
        isGuest: false,
      },
    });

    // 3. Mark any active tokens for these bookings as used
    await tx.guestBookingToken.updateMany({
      where: {
        bookingId: { in: bookingIds },
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });

    // 4. Create immutable audit log records for each claimed booking
    for (const b of eligibleBookings) {
      await tx.bookingClaimAudit.create({
        data: {
          bookingId: b.id,
          previousUserId: b.customerId,
          newUserId: userId,
          claimedByEmail: normalizedEmail,
          claimMethod,
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      });
    }

    logger.info(
      {
        count: eligibleBookings.length,
        bookingIds,
        userId,
        email: normalizedEmail,
        claimMethod,
      },
      "Batch claimed guest bookings for customer"
    );

    return {
      claimedCount: eligibleBookings.length,
      bookingIds,
    };
  });
};
