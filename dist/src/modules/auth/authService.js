import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import env from "../../config/env.js";
import logger from "../../shared/logger/logger.js";
import AppError from "../../shared/utils/AppError.js";
import { sendEmail } from "../../shared/utils/mailer.js";
import { isUniqueConstraintError } from "../../shared/utils/prismaError.js";
import * as authRepository from "./authRepository.js";
import { getStaffInvitationEmail, getAgentInvitationEmail, getPasswordResetEmail, } from "./emailTemplates.js";
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("dummy-password-placeholder", 10);
const INVALID_RESET_MESSAGE = "Invalid or expired password reset token";
const INVALID_INVITATION_MESSAGE = "Invalid or expired invitation token";
export const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const generateToken = (id, role, tokenVersion) => {
    return jwt.sign({ id, role, tv: tokenVersion }, env.jwtSecret, {
        expiresIn: "7d",
        jwtid: randomUUID(),
    });
};
export const registerUser = async (data) => {
    const existingUser = await authRepository.findUserByEmail(data.email);
    if (existingUser) {
        throw new AppError("Email already registered", 409);
    }
    const hashedPassword = await bcrypt.hash(data.password, 10);
    try {
        const user = await authRepository.createUser({
            name: data.name,
            email: data.email,
            password: hashedPassword,
            role: "customer",
        });
        return { user, token: generateToken(user.id, user.role, 0) };
    }
    catch (error) {
        if (isUniqueConstraintError(error)) {
            throw new AppError("Email already registered", 409);
        }
        throw error;
    }
};
export const loginUser = async (data) => {
    const user = await authRepository.findUserWithPassword(data.email);
    if (!user) {
        await bcrypt.compare(data.password, DUMMY_PASSWORD_HASH);
        throw new AppError("Invalid email or password", 401);
    }
    const isMatch = await bcrypt.compare(data.password, user.password);
    if (!isMatch) {
        throw new AppError("Invalid email or password", 401);
    }
    if (user.status !== "active") {
        throw new AppError("Account is deactivated", 403);
    }
    return {
        token: generateToken(user.id, user.role, user.tokenVersion),
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
        },
    };
};
export const logoutUser = async (session) => {
    await authRepository.revokeToken(session.jti, new Date(session.exp * 1000));
    await authRepository.deleteExpiredRevokedTokens();
};
export const issueRawTokenAndStore = async (userId, ttlMinutes) => {
    const rawToken = randomBytes(32).toString("hex");
    await authRepository.replacePasswordResetToken({
        userId,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
    });
    return rawToken;
};
export const sendPasswordResetEmail = async (user) => {
    const rawToken = await issueRawTokenAndStore(user.id, env.resetTokenTtlMinutes);
    const resetUrl = `${env.frontendUrl}/reset-password?token=${rawToken}`;
    const emailContent = getPasswordResetEmail({
        name: user.name,
        email: user.email,
        resetUrl,
        expiresMinutes: env.resetTokenTtlMinutes,
    });
    await sendEmail({
        to: user.email,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
    });
};
export const sendAccountSetupEmail = async (user) => {
    const ttlMinutes = env.inviteTokenTtlHours * 60;
    const rawToken = await issueRawTokenAndStore(user.id, ttlMinutes);
    const setupUrl = `${env.frontendUrl}/setup-account?token=${rawToken}`;
    const emailContent = user.role === "staff"
        ? getStaffInvitationEmail({
            name: user.name,
            email: user.email,
            setupUrl,
            expiresHours: env.inviteTokenTtlHours,
        })
        : user.role === "agent"
            ? getAgentInvitationEmail({
                name: user.name,
                email: user.email,
                setupUrl,
                expiresHours: env.inviteTokenTtlHours,
            })
            : {
                subject: "Set up your account password",
                text: `Hello ${user.name},\n\nAn account has been created for you. Use the link below to set your password. It expires in ${env.inviteTokenTtlHours} hours.\n\n${setupUrl}`,
                html: `<p>Hello ${user.name},</p><p>Please use this link to set your password: <a href="${setupUrl}">${setupUrl}</a></p>`,
            };
    await sendEmail({
        to: user.email,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
    });
};
export const forgotPassword = async (data) => {
    const user = await authRepository.findUserByEmail(data.email);
    if (!user || user.status !== "active") {
        return;
    }
    try {
        await sendPasswordResetEmail(user);
    }
    catch (error) {
        logger.error({ err: error }, "Failed to issue password reset email");
    }
};
export const validateInvitationToken = async (token) => {
    if (!token) {
        throw new AppError(INVALID_INVITATION_MESSAGE, 400);
    }
    const record = await authRepository.findActivePasswordResetToken(hashToken(token));
    if (!record || record.userStatus === "deactivated") {
        throw new AppError(INVALID_INVITATION_MESSAGE, 400);
    }
    return {
        valid: true,
        user: {
            name: record.userName,
            email: record.userEmail,
            role: record.userRole,
        },
    };
};
export const resetPassword = async (data) => {
    const record = await authRepository.findActivePasswordResetToken(hashToken(data.token));
    if (!record || record.userStatus === "deactivated") {
        throw new AppError(INVALID_RESET_MESSAGE, 400);
    }
    const passwordHash = await bcrypt.hash(data.password, 10);
    const updated = await authRepository.resetPasswordWithToken({
        tokenId: record.id,
        userId: record.userId,
        passwordHash,
    });
    if (!updated) {
        throw new AppError(INVALID_RESET_MESSAGE, 400);
    }
};
