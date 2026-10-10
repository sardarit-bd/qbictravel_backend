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
  createdAt: true,
  updatedAt: true,
  agentProfile: { select: { agencyName: true } },
} as const;

const buildWhere = ({ role, status, search }: ListUsersQuery) => ({
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
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
};

export const findUserById = async (id: string): Promise<AdminUser | null> => {
  return db.user.findUnique({ where: { id }, select: adminUserSelect });
};

export const updateUser = async (
  id: string,
  data: UpdateAgentInput,
): Promise<AdminUser> => {
  const { agencyName, ...userFields } = data;

  return db.user.update({
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
};

export const createAccount = async (
  data: CreateAccountInput,
): Promise<AdminUser> => {
  return db.user.create({
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
};