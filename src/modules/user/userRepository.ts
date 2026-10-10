import { db } from "../../config/database/index.js";
import type { UserProfile } from "../../types/common.js";
import type { UpdateProfileInput } from "./userTypes.js";

const profileSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  createdAt: true,
} as const;

export const findProfileById = async (
  id: string,
): Promise<UserProfile | null> => {
  return db.user.findUnique({ where: { id }, select: profileSelect });
};

export const updateProfile = async (
  id: string,
  data: UpdateProfileInput,
): Promise<UserProfile> => {
  return db.user.update({
    where: { id },
    data: { name: data.name, phone: data.phone },
    select: profileSelect,
  });
};