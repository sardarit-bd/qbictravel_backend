import { db } from "../../config/database/index.js";
import type { PaginatedResult } from "../../types/common.js";
import type {
  AdminUser,
  CreateAccountInput,
  ListUsersQuery,
  UpdateAgentInput,
} from "./adminTypes.js";

const adminUserSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  agentProfile: { select: { agencyName: true } },
  passwordResetTokens: {
    select: {
      id: true,
      expiresAt: true,
      usedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
} as const;

type DbUserWithTokens = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: AdminUser["role"];
  status: AdminUser["status"];
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  agentProfile: { agencyName: string | null } | null;
  passwordResetTokens: Array<{
    id: string;
    expiresAt: Date;
    usedAt: Date | null;
    createdAt: Date;
  }>;
};

const formatAdminUser = (user: DbUserWithTokens): AdminUser => {
  const latestToken = user.passwordResetTokens?.[0];
  let invitationStatus: "none" | "pending" | "expired" | "completed" = "none";
  let canResendInvitation = false;

  if (user.role === "staff" || user.role === "agent") {
    if (latestToken) {
      if (latestToken.usedAt !== null) {
        invitationStatus = "completed";
      } else if (new Date(latestToken.expiresAt) > new Date()) {
        invitationStatus = "pending";
        canResendInvitation = true;
      } else {
        invitationStatus = "expired";
        canResendInvitation = true;
      }
    }
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    deletedAt: user.deletedAt,
    invitationStatus,
    canResendInvitation,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    agentProfile: user.agentProfile,
  };
};

const buildWhere = ({ role, status, search }: ListUsersQuery) => ({
  deletedAt: null,
  ...(role ? { role } : {}),
  ...(status ? { status } : {}),
  ...(search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {}),
});

export const listUsers = async (
  query: ListUsersQuery,
): Promise<PaginatedResult<AdminUser>> => {
  const where = buildWhere(query);

  const [items, total] = await db.$transaction([
    db.user.findMany({
      where,
      select: adminUserSelect,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    db.user.count({ where }),
  ]);

  return {
    items: items.map(formatAdminUser),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
};

export const findUserById = async (id: string): Promise<AdminUser | null> => {
  const user = await db.user.findFirst({
    where: { id, deletedAt: null },
    select: adminUserSelect,
  });

  return user ? formatAdminUser(user) : null;
};

export const updateUser = async (
  id: string,
  data: UpdateAgentInput,
): Promise<AdminUser> => {
  const { agencyName, ...userFields } = data;

  const updated = await db.user.update({
    where: { id },
    data: {
      ...userFields,
      ...(agencyName !== undefined
        ? {
            agentProfile: {
              upsert: {
                create: { agencyName },
                update: { agencyName },
              },
            },
          }
        : {}),
    },
    select: adminUserSelect,
  });

  return formatAdminUser(updated);
};

export const createAccount = async (
  data: CreateAccountInput,
): Promise<AdminUser> => {
  const created = await db.user.create({
    data: {
      name: data.name,
      email: data.email,
      password: data.password,
      phone: data.phone,
      role: data.role,
      ...(data.role === "agent"
        ? { agentProfile: { create: { agencyName: data.agencyName } } }
        : {}),
    },
    select: adminUserSelect,
  });

  return formatAdminUser(created);
};

export const deleteUser = async (userId: string): Promise<AdminUser> => {
  return db.$transaction(async (tx) => {
    // 1. Invalidate active reset/setup tokens
    await tx.passwordResetToken.deleteMany({
      where: { userId },
    });

    // 2. Clear staff permissions if any
    await tx.staffPermission.deleteMany({
      where: { userId },
    });

    // 3. Increment tokenVersion and soft-delete user
    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        status: "deactivated",
        tokenVersion: { increment: 1 },
      },
      select: adminUserSelect,
    });

    return formatAdminUser(updated);
  });
};