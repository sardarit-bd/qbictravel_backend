import { db } from "../../config/database/index.js";
import type {
  AuthUser,
  AuthUserRecord,
  AuthUserWithPassword,
  CreateUserInput,
  PasswordResetTokenRecord,
} from "./authTypes.js";

const authUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
} as const;

const authRecordSelect = {
  ...authUserSelect,
  status: true,
  tokenVersion: true,
} as const;

export interface ActiveTokenDetails extends PasswordResetTokenRecord {
  userName: string;
  userEmail: string;
  userRole: string;
}

export const findUserByEmail = async (
  email: string,
): Promise<AuthUserRecord | null> => {
  return db.user.findFirst({
    where: { email, deletedAt: null },
    select: authRecordSelect,
  });
};

export const findAuthUserById = async (
  id: string,
): Promise<AuthUserRecord | null> => {
  return db.user.findFirst({
    where: { id, deletedAt: null },
    select: authRecordSelect,
  });
};

export const findUserWithPasswordById = async (
  id: string,
): Promise<AuthUserWithPassword | null> => {
  return db.user.findFirst({
    where: { id, deletedAt: null },
    select: { ...authRecordSelect, password: true },
  });
};

export const findUserWithPassword = async (
  email: string,
): Promise<AuthUserWithPassword | null> => {
  return db.user.findFirst({
    where: { email, deletedAt: null },
    select: { ...authRecordSelect, password: true },
  });
};

export const createUser = async (data: CreateUserInput): Promise<AuthUser> => {
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

export const revokeToken = async (
  jti: string,
  expiresAt: Date,
): Promise<void> => {
  await db.revokedToken.upsert({
    where: { jti },
    update: {},
    create: { jti, expiresAt },
  });
};

export const isTokenRevoked = async (jti: string): Promise<boolean> => {
  const row = await db.revokedToken.findUnique({
    where: { jti },
    select: { jti: true },
  });

  return row !== null;
};

export const deleteExpiredRevokedTokens = async (): Promise<void> => {
  await db.revokedToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
};

export const replacePasswordResetToken = async (data: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> => {
  await db.$transaction([
    db.passwordResetToken.deleteMany({
      where: { userId: data.userId, usedAt: null },
    }),
    db.passwordResetToken.create({ data }),
  ]);
};

export const findActivePasswordResetToken = async (
  tokenHash: string,
): Promise<ActiveTokenDetails | null> => {
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

export const resetPasswordWithToken = async (data: {
  tokenId: string;
  userId: string;
  passwordHash: string;
}): Promise<boolean> => {
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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Session & RefreshToken Management (Dual-Token Architecture with Rotation)
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface CreateSessionWithTokenParams {
  userId: string;
  userAgent?: string;
  ipAddress?: string;
  sessionExpiresAt: Date;
  tokenHash: string;
  tokenExpiresAt: Date;
  familyId: string;
}

export const createSessionWithToken = async (
  params: CreateSessionWithTokenParams,
) => {
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

export const findRefreshTokenRecord = async (tokenHash: string) => {
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

export interface RotateRefreshTokenParams {
  currentTokenId: string;
  sessionId: string;
  familyId: string;
  nextSequence: number;
  newTokenHash: string;
  newTokenExpiresAt: Date;
  newSessionExpiresAt: Date;
}

/**
 * Atomically consumes current token and creates the next token in the family chain.
 * Uses strict update count check to prevent concurrent race conditions from consuming the same token twice.
 */
export const rotateRefreshTokenAtomic = async (
  params: RotateRefreshTokenParams,
) => {
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
export const revokeTokenFamily = async (familyId: string, sessionId?: string) => {
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

export const revokeSessionById = async (sessionId: string) => {
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

export const revokeAllUserSessions = async (userId: string) => {
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

export const isSessionActive = async (sessionId: string): Promise<boolean> => {
  const session = await db.session.findUnique({
    where: { id: sessionId },
    select: { revokedAt: true, expiresAt: true },
  });

  if (!session) return false;
  if (session.revokedAt !== null) return false;
  if (session.expiresAt <= new Date()) return false;
  return true;
};
