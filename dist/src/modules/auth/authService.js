import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import env from "../../config/env.js";
import logger from "../../shared/logger/logger.js";
import AppError from "../../shared/utils/AppError.js";
import { sendEmail } from "../../shared/utils/mailer.js";
import { isUniqueConstraintError } from "../../shared/utils/prismaError.js";
import * as authRepository from "./authRepository.js";
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("dummy-password-placeholder", 10);
const INVALID_RESET_MESSAGE = "Invalid or expired password reset token";
const hashToken = (token) => createHash("sha256").update(token).digest("hex");
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
const issueSetupLink = async (userId, ttlMinutes) => {
    const rawToken = randomBytes(32).toString("hex");
    await authRepository.replacePasswordResetToken({
        userId,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
    });
    return `${env.frontendUrl}/reset-password?token=${rawToken}`;
};
export const sendPasswordResetEmail = async (user) => {
    const link = await issueSetupLink(user.id, env.resetTokenTtlMinutes);
    await sendEmail({
        to: user.email,
        subject: "Reset your password",
        text: `Hello ${user.name},\n\nUse the link below to reset your password. It expires in ${env.resetTokenTtlMinutes} minutes.\n\n${link}\n\nIf you did not request this, you can ignore this email.`,
    });
};
export const sendAccountSetupEmail = async (user) => {
    const link = await issueSetupLink(user.id, env.inviteTokenTtlHours * 60);
    await sendEmail({
        to: user.email,
        subject: "Set up your account password",
        text: `Hello ${user.name},\n\nAn account has been created for you. Use the link below to set your password. It expires in ${env.inviteTokenTtlHours} hours.\n\n${link}`,
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
export const resetPassword = async (data) => {
    const record = await authRepository.findActivePasswordResetToken(hashToken(data.token));
    if (!record || record.userStatus !== "active") {
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
