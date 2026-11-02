import { prisma } from "../../lib/prisma.js";
import { encryptSecret, decryptSecret } from "./settingCrypto.js";
import type { ListSettingAuditLogsQuery, SettingAuditLogItem } from "./settingTypes.js";

/**
 * Retrieve all system settings from database.
 */
export const getAllSettings = async () => {
  return prisma.systemSetting.findMany({
    orderBy: [{ category: "asc" }, { key: "asc" }],
  });
};

/**
 * Retrieve settings by category.
 */
export const getSettingsByCategory = async (category: string) => {
  return prisma.systemSetting.findMany({
    where: { category },
    orderBy: { key: "asc" },
  });
};

/**
 * Retrieve a specific setting by key.
 */
export const getSettingByKey = async (key: string) => {
  return prisma.systemSetting.findUnique({
    where: { key },
  });
};

/**
 * Upsert a plaintext setting.
 */
export const setPlaintextSetting = async (
  category: string,
  key: string,
  value: string,
  updatedById?: string,
  description?: string
) => {
  return prisma.systemSetting.upsert({
    where: { key },
    create: {
      category,
      key,
      value,
      isSecret: false,
      encryptedValue: null,
      description,
      updatedById,
    },
    update: {
      category,
      value,
      isSecret: false,
      encryptedValue: null,
      description: description ?? undefined,
      updatedById,
    },
  });
};

/**
 * Upsert an encrypted secret setting.
 * Plaintext is encrypted with AES-256-GCM before storage.
 * The plaintext value column is always set to null.
 */
export const setSecretSetting = async (
  category: string,
  key: string,
  secretPlaintext: string,
  updatedById?: string,
  description?: string
) => {
  const encryptedValue = encryptSecret(secretPlaintext);
  return prisma.systemSetting.upsert({
    where: { key },
    create: {
      category,
      key,
      value: null,
      isSecret: true,
      encryptedValue,
      description,
      updatedById,
    },
    update: {
      category,
      value: null,
      isSecret: true,
      encryptedValue,
      description: description ?? undefined,
      updatedById,
    },
  });
};

/**
 * Decrypt a secret setting safely.
 * Returns null if not found or if encrypted value is missing.
 */
export const getDecryptedSecretSetting = async (key: string): Promise<string | null> => {
  const record = await prisma.systemSetting.findUnique({
    where: { key },
  });
  if (!record || !record.isSecret || !record.encryptedValue) {
    return null;
  }
  return decryptSecret(record.encryptedValue);
};

/**
 * Insert an audit log record for settings changes.
 * Guaranteed never to contain plaintext secret values.
 */
export const logSettingAudit = async (params: {
  category: string;
  action: string;
  status?: "SUCCESS" | "FAILURE";
  actorId?: string | null;
  actorName: string;
  actorEmail: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}) => {
  return prisma.settingAuditLog.create({
    data: {
      category: params.category,
      action: params.action,
      status: params.status || "SUCCESS",
      actorId: params.actorId || null,
      actorName: params.actorName,
      actorEmail: params.actorEmail,
      ipAddress: params.ipAddress || null,
      userAgent: params.userAgent || null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  });
};

/**
 * List configuration audit logs with pagination and filters.
 */
export const listSettingAuditLogs = async (
  query: ListSettingAuditLogsQuery
): Promise<{ items: SettingAuditLogItem[]; total: number; page: number; limit: number; pages: number }> => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (query.category) where.category = query.category;
  if (query.status) where.status = query.status;

  const [records, total] = await Promise.all([
    prisma.settingAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.settingAuditLog.count({ where }),
  ]);

  const items: SettingAuditLogItem[] = records.map((r) => {
    let parsedMetadata: Record<string, unknown> | null = null;
    if (r.metadata) {
      try {
        parsedMetadata = JSON.parse(r.metadata);
      } catch {
        parsedMetadata = null;
      }
    }
    return {
      id: r.id,
      category: r.category,
      action: r.action,
      status: r.status,
      actorId: r.actorId,
      actorName: r.actorName,
      actorEmail: r.actorEmail,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      metadata: parsedMetadata,
      createdAt: r.createdAt.toISOString(),
    };
  });

  return {
    items,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit) || 1,
  };
};
