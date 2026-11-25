import crypto from "crypto";
import { prisma } from "../../lib/prisma.js";
import AppError from "../../shared/utils/AppError.js";
import { hashToken } from "../payment/tokenUtils.js";
import { sendEmail } from "../../shared/utils/mailer.js";
import env from "../../config/env.js";
import logger from "../../shared/logger/logger.js";
import { claimGuestBookingsForUser } from "../customer/bookingClaimService.js";

const VERIFICATION_TOKEN_TTL_HOURS = 24;

export const generateSecureVerificationToken = (): string => {
  return crypto.randomBytes(32).toString("hex");
};

/**
 * Creates and sends an email verification token to the user.
 */
export const sendVerificationEmail = async (user: {
  id: string;
  name: string;
  email: string;
}): Promise<void> => {
  const rawToken = generateSecureVerificationToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(
    Date.now() + VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000
  );

  // Store token
  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      email: user.email.toLowerCase(),
      tokenHash,
      expiresAt,
    },
  });

  const verifyUrl = `${env.frontendUrl}/verify-email?token=${rawToken}`;

  try {
    await sendEmail({
      to: user.email,
      subject: "Verify your email address - Phuket Tours",
      text: `Hello ${user.name},\n\nPlease verify your email address by clicking the link below:\n\n${verifyUrl}\n\nThis link will expire in ${VERIFICATION_TOKEN_TTL_HOURS} hours.\n\nThank you,\nPhuket Tours Team`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2>Verify Your Email Address</h2>
          <p>Hello ${user.name},</p>
          <p>Thank you for registering with Phuket Tours. Please verify your email address to secure your account and link any previous guest bookings.</p>
          <div style="margin: 30px 0;">
            <a href="${verifyUrl}" style="background-color: #0284c7; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              Verify Email Address
            </a>
          </div>
          <p style="color: #64748b; font-size: 14px;">This link will expire in ${VERIFICATION_TOKEN_TTL_HOURS} hours.</p>
        </div>
      `,
    });
  } catch (err) {
    logger.error({ err, userId: user.id }, "Failed to send verification email");
  }
};

/**
 * Verifies an email token and automatically claims any matching guest bookings.
 */
export const verifyEmailAndClaimBookings = async (
  rawToken: string,
  context: { ipAddress?: string; userAgent?: string } = {}
): Promise<{ success: boolean; email: string; claimedCount: number }> => {
  if (!rawToken || typeof rawToken !== "string" || !rawToken.trim()) {
    throw new AppError("Verification token is required", 400);
  }

  const tokenHash = hashToken(rawToken.trim());

  return await prisma.$transaction(async (tx) => {
    const record = await tx.emailVerificationToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record) {
      throw new AppError("Invalid or expired verification token", 404);
    }

    if (record.verifiedAt) {
      return { success: true, email: record.email, claimedCount: 0 };
    }

    if (new Date() > new Date(record.expiresAt)) {
      throw new AppError("Verification token has expired", 410);
    }

    // Mark token as verified
    await tx.emailVerificationToken.update({
      where: { id: record.id },
      data: { verifiedAt: new Date() },
    });

    // Automatically claim eligible guest bookings matching user's verified email
    const claimResult = await claimGuestBookingsForUser(
      record.userId,
      record.email,
      "EMAIL_VERIFICATION",
      context
    );

    return {
      success: true,
      email: record.email,
      claimedCount: claimResult.claimedCount,
    };
  });
};
