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
export const generateAccessToken = (id, role, tokenVersion, sessionId) => {
    return jwt.sign({
        id,
        role,
        tv: tokenVersion,
        sid: sessionId,
        type: "access",
    }, env.jwtSecret, {
        expiresIn: "15m",
        jwtid: randomUUID(),
        issuer: "phukettours",
        audience: "phukettours-api",
    });
};
export const generateLegacyToken = (id, role, tokenVersion, sessionId) => {
    return jwt.sign({
        id,
        role,
        tv: tokenVersion,
        sid: sessionId,
        type: "legacy",
    }, env.jwtSecret, {
        expiresIn: "7d",
        jwtid: randomUUID(),
    });
};
export const generateOpaqueRefreshToken = () => {
    return randomBytes(32).toString("hex");
};
export const registerUser = async (data, context = {}) => {
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
        // Create session and initial refresh token in rotation family
        const rawRefreshToken = generateOpaqueRefreshToken();
        const tokenHash = hashToken(rawRefreshToken);
        const familyId = randomUUID();
        const sessionExpiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
        const { session } = await authRepository.createSessionWithToken({
            userId: user.id,
            userAgent: context.userAgent,
            ipAddress: context.ipAddress,
            sessionExpiresAt,
            tokenHash,
            tokenExpiresAt: sessionExpiresAt,
            familyId,
        });
        const accessToken = generateAccessToken(user.id, user.role, 0, session.id);
        return {
            user,
            token: accessToken,
            accessToken,
            refreshToken: rawRefreshToken,
            sessionId: session.id,
        };
    }
    catch (error) {
        if (isUniqueConstraintError(error)) {
            throw new AppError("Email already registered", 409);
        }
        throw error;
    }
};
export const loginUser = async (data, context = {}) => {
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
    // Create session and initial refresh token in rotation family
    const rawRefreshToken = generateOpaqueRefreshToken();
    const tokenHash = hashToken(rawRefreshToken);
    const familyId = randomUUID();
    const sessionExpiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
    const { session } = await authRepository.createSessionWithToken({
        userId: user.id,
        userAgent: context.userAgent,
        ipAddress: context.ipAddress,
        sessionExpiresAt,
        tokenHash,
        tokenExpiresAt: sessionExpiresAt,
        familyId,
    });
    const accessToken = generateAccessToken(user.id, user.role, user.tokenVersion, session.id);
    return {
        token: accessToken,
        accessToken,
        refreshToken: rawRefreshToken,
        sessionId: session.id,
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
        },
    };
};
/**
 * Rotates an opaque refresh token atomically. Detects reuse of consumed tokens.
 */
export const refreshSession = async (rawRefreshToken, _context = {}) => {
    if (!rawRefreshToken || typeof rawRefreshToken !== "string") {
        throw new AppError("Refresh token missing or invalid", 401);
    }
    const tokenHash = hashToken(rawRefreshToken);
    const tokenRecord = await authRepository.findRefreshTokenRecord(tokenHash);
    if (!tokenRecord) {
        throw new AppError("Invalid or expired session", 401);
    }
    // Reuse Detection: if this token was already consumed, a replay attack is occurring!
    if (tokenRecord.isConsumed) {
        logger.warn(`[Security] Refresh token reuse detected for family ${tokenRecord.familyId}. Revoking entire session.`);
        await authRepository.revokeTokenFamily(tokenRecord.familyId, tokenRecord.sessionId);
        throw new AppError("Suspicious session activity detected. Please sign in again.", 401);
    }
    // Check if token or session is explicitly revoked
    if (tokenRecord.revokedAt || tokenRecord.session.revokedAt) {
        throw new AppError("Session has been revoked. Please sign in again.", 401);
    }
    // Check expiration
    const now = new Date();
    if (tokenRecord.expiresAt <= now || tokenRecord.session.expiresAt <= now) {
        throw new AppError("Session has expired. Please sign in again.", 401);
    }
    const user = tokenRecord.session.user;
    if (!user || user.status !== "active") {
        throw new AppError("Account is no longer active", 403);
    }
    // Generate next token in rotation
    const nextRawRefreshToken = generateOpaqueRefreshToken();
    const nextTokenHash = hashToken(nextRawRefreshToken);
    const nextSequence = tokenRecord.sequence + 1;
    const newSessionExpiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
    const rotatedToken = await authRepository.rotateRefreshTokenAtomic({
        currentTokenId: tokenRecord.id,
        sessionId: tokenRecord.sessionId,
        familyId: tokenRecord.familyId,
        nextSequence,
        newTokenHash: nextTokenHash,
        newTokenExpiresAt: newSessionExpiresAt,
        newSessionExpiresAt,
    });
    if (!rotatedToken) {
        // Concurrency conflict: another simultaneous request consumed this token
        throw new AppError("Concurrent refresh detected. Please retry.", 409);
    }
    const newAccessToken = generateAccessToken(user.id, user.role, user.tokenVersion, tokenRecord.sessionId);
    return {
        token: newAccessToken,
        accessToken: newAccessToken,
        refreshToken: nextRawRefreshToken,
        sessionId: tokenRecord.sessionId,
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
        },
    };
};
export const logoutUser = async (session) => {
    // Revoke the specific server-side session if present
    if (session.sessionId) {
        await authRepository.revokeSessionById(session.sessionId);
    }
    // Also revoke legacy/jwt JTI
    if (session.jti && session.exp) {
        await authRepository.revokeToken(session.jti, new Date(session.exp * 1000));
        await authRepository.deleteExpiredRevokedTokens();
    }
};
export const logoutByRefreshToken = async (rawRefreshToken) => {
    if (!rawRefreshToken)
        return;
    const tokenHash = hashToken(rawRefreshToken);
    const tokenRecord = await authRepository.findRefreshTokenRecord(tokenHash);
    if (tokenRecord) {
        await authRepository.revokeSessionById(tokenRecord.sessionId);
    }
};
export const logoutAllSessions = async (userId) => {
    await authRepository.revokeAllUserSessions(userId);
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
export const validateResetPasswordToken = async (token) => {
    if (!token) {
        throw new AppError(INVALID_RESET_MESSAGE, 400);
    }
    const record = await authRepository.findActivePasswordResetToken(hashToken(token));
    if (!record || record.userStatus === "deactivated") {
        throw new AppError(INVALID_RESET_MESSAGE, 400);
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
