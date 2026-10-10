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

export const findUserByEmail = async (
  email: string,
): Promise<AuthUserRecord | null> => {
  return db.user.findUnique({
    where: { email },
    select: authRecordSelect,
  });
};

export const findAuthUserById = async (
  id: string,
): Promise<AuthUserRecord | null> => {
  return db.user.findUnique({
    where: { id },
    select: authRecordSelect,
  });
};

export const findUserWithPassword = async (
  email: string,
): Promise<AuthUserWithPassword | null> => {
  return db.user.findUnique({
    where: { email },
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
): Promise<PasswordResetTokenRecord | null> => {
  const record = await db.passwordResetToken.findFirst({
    where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, userId: true, user: { select: { status: true } } },
  });

  if (!record) {
    return null;
  }

  return { id: record.id, userId: record.userId, userStatus: record.user.status };
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

    return true;
  });
};