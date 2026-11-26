import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateSecureVerificationToken,
  sendVerificationEmail,
  verifyEmailAndClaimBookings,
} from "../../emailVerificationService.js";
import { prisma } from "../../../../lib/prisma.js";
import { hashToken } from "../../../payment/tokenUtils.js";
import * as mailer from "../../../../shared/utils/mailer.js";
import * as bookingClaimService from "../../../customer/bookingClaimService.js";
import AppError from "../../../../shared/utils/AppError.js";

describe("emailVerificationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateSecureVerificationToken", () => {
    it("generates a 64-character hex string", () => {
      const token = generateSecureVerificationToken();
      expect(typeof token).toBe("string");
      expect(token).toHaveLength(64);
    });
  });

  describe("sendVerificationEmail", () => {
    it("creates an email verification token record and calls sendEmail", async () => {
      const mockCreate = vi.fn().mockResolvedValue({});
      vi.spyOn(prisma.emailVerificationToken, "create").mockImplementation(mockCreate);
      const sendEmailSpy = vi.spyOn(mailer, "sendEmail").mockResolvedValue({} as any);

      await sendVerificationEmail({
        id: "user-1",
        name: "John Doe",
        email: "john@example.com",
      });

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          userId: "user-1",
          email: "john@example.com",
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        },
      });

      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "john@example.com",
          subject: expect.stringContaining("Verify your email"),
        })
      );
    });
  });

  describe("verifyEmailAndClaimBookings", () => {
    const rawToken = "raw-test-verification-token-123";
    const tokenHash = hashToken(rawToken);

    it("throws 400 if token is missing or empty", async () => {
      await expect(verifyEmailAndClaimBookings("")).rejects.toThrow(
        new AppError("Verification token is required", 400)
      );
    });

    it("throws 404 if token record not found", async () => {
      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        return callback({
          emailVerificationToken: {
            findUnique: vi.fn().mockResolvedValue(null),
          },
        });
      });

      await expect(verifyEmailAndClaimBookings(rawToken)).rejects.toThrow(
        new AppError("Invalid or expired verification token", 404)
      );
    });

    it("returns success if token was already verified previously", async () => {
      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        return callback({
          emailVerificationToken: {
            findUnique: vi.fn().mockResolvedValue({
              id: "t-1",
              tokenHash,
              verifiedAt: new Date(),
              email: "john@example.com",
              userId: "user-1",
            }),
          },
        });
      });

      const res = await verifyEmailAndClaimBookings(rawToken);
      expect(res).toEqual({
        success: true,
        email: "john@example.com",
        claimedCount: 0,
      });
    });

    it("throws 410 if token is expired", async () => {
      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        return callback({
          emailVerificationToken: {
            findUnique: vi.fn().mockResolvedValue({
              id: "t-1",
              tokenHash,
              verifiedAt: null,
              expiresAt: new Date(Date.now() - 1000),
              email: "john@example.com",
              userId: "user-1",
            }),
          },
        });
      });

      await expect(verifyEmailAndClaimBookings(rawToken)).rejects.toThrow(
        new AppError("Verification token has expired", 410)
      );
    });

    it("marks token verified and automatically claims guest bookings", async () => {
      const mockUpdateToken = vi.fn().mockResolvedValue({});
      const claimSpy = vi
        .spyOn(bookingClaimService, "claimGuestBookingsForUser")
        .mockResolvedValue({ claimedCount: 3, bookingIds: ["b-1", "b-2", "b-3"] });

      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        return callback({
          emailVerificationToken: {
            findUnique: vi.fn().mockResolvedValue({
              id: "t-100",
              tokenHash,
              verifiedAt: null,
              expiresAt: new Date(Date.now() + 86400000),
              email: "john@example.com",
              userId: "user-100",
            }),
            update: mockUpdateToken,
          },
        });
      });

      const res = await verifyEmailAndClaimBookings(rawToken, {
        ipAddress: "127.0.0.1",
        userAgent: "JestTest",
      });

      expect(res).toEqual({
        success: true,
        email: "john@example.com",
        claimedCount: 3,
      });
      expect(mockUpdateToken).toHaveBeenCalledWith({
        where: { id: "t-100" },
        data: { verifiedAt: expect.any(Date) },
      });
      expect(claimSpy).toHaveBeenCalledWith(
        "user-100",
        "john@example.com",
        "EMAIL_VERIFICATION",
        { ipAddress: "127.0.0.1", userAgent: "JestTest" }
      );
    });
  });
});
