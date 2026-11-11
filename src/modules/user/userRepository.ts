import { db } from "../../config/database/index.js";
import type { UserProfile } from "../../types/common.js";
import type { UpdateProfileInput } from "./userTypes.js";

const profileSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  avatarUrl: true,
  role: true,
  status: true,
  createdAt: true,
} as const;

export const findProfileById = async (
  id: string,
): Promise<UserProfile | null> => {
  return db.user.findUnique({ where: { id }, select: profileSelect });
};

export const findUserByIdWithAvatar = async (id: string) => {
  return db.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      avatarUrl: true,
      avatarKey: true,
    },
  });
};

export const findUserByEmail = async (email: string) => {
  return db.user.findFirst({
    where: { email, deletedAt: null },
    select: { id: true, email: true },
  });
};

export const updateEmail = async (
  id: string,
  newEmail: string,
): Promise<UserProfile> => {
  return db.user.update({
    where: { id },
    data: { email: newEmail },
    select: profileSelect,
  });
};

export const updateProfile = async (
  id: string,
  data: UpdateProfileInput,
): Promise<UserProfile> => {
  return db.user.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.phone !== undefined && { phone: data.phone }),
      ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
      ...(data.avatarKey !== undefined && { avatarKey: data.avatarKey }),
    },
    select: profileSelect,
  });
};