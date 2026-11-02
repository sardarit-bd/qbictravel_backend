import AppError from "../../shared/utils/AppError.js";
import type { UserProfile } from "../../types/common.js";
import * as userRepository from "./userRepository.js";
import type { UpdateProfileInput } from "./userTypes.js";

export const getOwnProfile = async (userId: string): Promise<UserProfile> => {
  const profile = await userRepository.findProfileById(userId);

  if (!profile) {
    throw new AppError("User not found", 404);
  }

  return profile;
};

export const updateOwnProfile = async (
  userId: string,
  data: UpdateProfileInput,
): Promise<UserProfile> => {
  await getOwnProfile(userId);

  return userRepository.updateProfile(userId, {
    name: data.name,
    phone: data.phone,
  });
};