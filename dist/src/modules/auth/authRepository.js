import { db } from "../../config/database/index.js";
const authUserSelect = {
    id: true,
    name: true,
    email: true,
    role: true,
};
const authRecordSelect = {
    ...authUserSelect,
    status: true,
    tokenVersion: true,
};
export const findUserByEmail = async (email) => {
    return db.user.findFirst({
        where: { email, deletedAt: null },
        select: authRecordSelect,
    });
};
export const findAuthUserById = async (id) => {
    return db.user.findFirst({
        where: { id, deletedAt: null },
        select: authRecordSelect,
    });
};
export const findUserWithPasswordById = async (id) => {
    return db.user.findFirst({
        where: { id, deletedAt: null },
        select: { ...authRecordSelect, password: true },
    });
};
export const findUserWithPassword = async (email) => {
    return db.user.findFirst({
        where: { email, deletedAt: null },
        select: { ...authRecordSelect, password: true },
    });
};
export const createUser = async (data) => {
    return db.user.create({
        data: {
            name: data.name,
            email: data.email,
            password: data.password,
            role: data.role,
        },
        select: authUserSelect,
    });
};
export const revokeToken = async (jti, expiresAt) => {
    await db.revokedToken.upsert({
        where: { jti },
        update: {},
        create: { jti, expiresAt },
    });
};
export const isTokenRevoked = async (jti) => {
    const row = await db.revokedToken.findUnique({
        where: { jti },
        select: { jti: true },
    });
    return row !== null;
};
export const deleteExpiredRevokedTokens = async () => {
    await db.revokedToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
    });
};
export const replacePasswordResetToken = async (data) => {
    await db.$transaction([
        db.passwordResetToken.deleteMany({
            where: { userId: data.userId, usedAt: null },
        }),
        db.passwordResetToken.create({ data }),
    ]);
};
export const findActivePasswordResetToken = async (tokenHash) => {
    const record = await db.passwordResetToken.findFirst({
        where: {
            tokenHash,
            usedAt: null,
            expiresAt: { gt: new Date() },
            user: { deletedAt: null },
        },
        select: {
            id: true,
            userId: true,
            user: {
                select: {
                    name: true,
                    email: true,
                    role: true,
                    status: true,
                    deletedAt: true,
                },
            },
        },
    });
    if (!record || record.user.deletedAt !== null) {
        return null;
    }
    return {
        id: record.id,
        userId: record.userId,
        userStatus: record.user.status,
        userName: record.user.name,
        userEmail: record.user.email,
        userRole: record.user.role,
    };
};
export const resetPasswordWithToken = async (data) => {
    return db.$transaction(async (tx) => {
        const used = await tx.passwordResetToken.updateMany({
            where: {
                id: data.tokenId,
                usedAt: null,
                expiresAt: { gt: new Date() },
            },
            data: { usedAt: new Date() },
        });
        if (used.count !== 1) {
            return false;
        }
        await tx.user.update({
            where: { id: data.userId },
            data: {
                password: data.passwordHash,
                tokenVersion: { increment: 1 },
            },
        });
        await tx.passwordResetToken.deleteMany({
            where: { userId: data.userId, id: { not: data.tokenId } },
        });
        // Also revoke all active user sessions upon password reset
        await tx.session.updateMany({
            where: { userId: data.userId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
        return true;
    });
};
export const createSessionWithToken = async (params) => {
    return db.$transaction(async (tx) => {
        const session = await tx.session.create({
            data: {
                userId: params.userId,
                userAgent: params.userAgent,
                ipAddress: params.ipAddress,
                expiresAt: params.sessionExpiresAt,
                refreshTokens: {
                    create: {
                        tokenHash: params.tokenHash,
                        familyId: params.familyId,
                        sequence: 1,
                        expiresAt: params.tokenExpiresAt,
                    },
                },
            },
            include: {
                refreshTokens: true,
            },
        });
        return {
            session,
            refreshToken: session.refreshTokens[0],
        };
    });
};
export const findRefreshTokenRecord = async (tokenHash) => {
    return db.refreshToken.findUnique({
        where: { tokenHash },
        include: {
            session: {
                include: {
                    user: {
                        select: authRecordSelect,
                    },
                },
            },
        },
    });
};
/**
 * Atomically consumes current token and creates the next token in the family chain.
 * Uses strict update count check to prevent concurrent race conditions from consuming the same token twice.
 */
export const rotateRefreshTokenAtomic = async (params) => {
    return db.$transaction(async (tx) => {
        // 1. Consume current token with atomic concurrency lock
        const updated = await tx.refreshToken.updateMany({
            where: {
                id: params.currentTokenId,
                isConsumed: false,
                revokedAt: null,
            },
            data: {
                isConsumed: true,
                consumedAt: new Date(),
            },
        });
        if (updated.count !== 1) {
            // Token was already consumed concurrently or revoked
            return null;
        }
        // 2. Insert next token in rotation sequence
        const nextToken = await tx.refreshToken.create({
            data: {
                sessionId: params.sessionId,
                tokenHash: params.newTokenHash,
                familyId: params.familyId,
                sequence: params.nextSequence,
                expiresAt: params.newTokenExpiresAt,
            },
        });
        // 3. Update session's lastActiveAt and sliding expiration
        await tx.session.update({
            where: { id: params.sessionId },
            data: {
                lastActiveAt: new Date(),
                expiresAt: params.newSessionExpiresAt,
            },
        });
        return nextToken;
    });
};
/**
 * Revokes all tokens in a family and marks session revoked when reuse is detected.
 */
export const revokeTokenFamily = async (familyId, sessionId) => {
    await db.$transaction(async (tx) => {
        await tx.refreshToken.updateMany({
            where: { familyId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
        if (sessionId) {
            await tx.session.updateMany({
                where: { id: sessionId, revokedAt: null },
                data: { revokedAt: new Date() },
            });
        }
    });
};
export const revokeSessionById = async (sessionId) => {
    await db.$transaction(async (tx) => {
        await tx.session.updateMany({
            where: { id: sessionId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
        await tx.refreshToken.updateMany({
            where: { sessionId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
    });
};
export const revokeAllUserSessions = async (userId) => {
    await db.$transaction(async (tx) => {
        await tx.session.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
        await tx.user.update({
            where: { id: userId },
            data: { tokenVersion: { increment: 1 } },
        });
    });
};
export const isSessionActive = async (sessionId) => {
    const session = await db.session.findUnique({
        where: { id: sessionId },
        select: { revokedAt: true, expiresAt: true },
    });
    if (!session)
        return false;
    if (session.revokedAt !== null)
        return false;
    if (session.expiresAt <= new Date())
        return false;
    return true;
};
