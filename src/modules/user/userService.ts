import { createHash, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import env from "../../config/env.js";
import {
  getCloudinaryClient,
  getCloudinaryConfig,
} from "../../config/cloudinary.js";
import AppError from "../../shared/utils/AppError.js";
import type { UserProfile } from "../../types/common.js";
import * as authRepository from "../auth/authRepository.js";
import {
  createMediaUploadAuthRecord,
  findMediaUploadAuthByPublicId,
} from "../media/mediaRepository.js";
import { prisma } from "../../lib/prisma.js";
import type { UploadTokenPayload } from "../media/mediaTypes.js";
import * as userRepository from "./userRepository.js";
import type {
  UpdateProfileInput,
  UpdateEmailInput,
  ProfileAvatarSignatureResponse,
  ConfirmProfileAvatarInput,
} from "./userTypes.js";

const AVATAR_FOLDER = "phukettours/avatars";
const AVATAR_MAX_BYTES = 5 * 1024 * 1024; // 5 MB max for avatars
const AVATAR_ALLOWED_FORMATS = ["jpg", "jpeg", "png", "webp"] as const;

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

/**
 * Update authenticated user's own email address.
 * Validates format, uniqueness across accounts, and verifies current password for security.
 */
export const updateOwnEmail = async (
  userId: string,
  input: UpdateEmailInput,
): Promise<UserProfile> => {
  const userWithPassword = await authRepository.findUserWithPasswordById(userId);
  if (!userWithPassword) {
    throw new AppError("User not found", 404);
  }

  const normalizedNewEmail = input.newEmail.trim().toLowerCase();

  // If new email is identical to current email
  if (normalizedNewEmail === userWithPassword.email.toLowerCase()) {
    throw new AppError("New email address must be different from current email", 400);
  }

  // Verify current password for re-authentication
  const isMatch = await bcrypt.compare(
    input.currentPassword,
    userWithPassword.password,
  );
  if (!isMatch) {
    throw new AppError("Invalid current password. Re-authentication failed.", 401);
  }

  // Check email uniqueness
  const existingUser = await userRepository.findUserByEmail(normalizedNewEmail);
  if (existingUser && existingUser.id !== userId) {
    throw new AppError("Email address is already in use by another account", 409);
  }

  return userRepository.updateEmail(userId, normalizedNewEmail);
};

/**
 * Generates signed Cloudinary upload parameters for uploading a profile avatar.
 * Folder is strictly isolated to phukettours/avatars and publicId is server-generated.
 */
export const generateAvatarUploadSignature = async (
  userId: string,
): Promise<ProfileAvatarSignatureResponse> => {
  const config = getCloudinaryConfig();
  const cloudinary = getCloudinaryClient();

  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `avatar_${userId}_${randomUUID().replace(/-/g, "")}`;

  const paramsToSign: Record<string, string | number | boolean> = {
    folder: AVATAR_FOLDER,
    overwrite: false,
    public_id: publicId,
    timestamp,
  };

  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    config.apiSecret,
  );

  const nonce = randomUUID();
  const uploadToken = jwt.sign(
    {
      adminId: userId,
      publicId,
      folder: AVATAR_FOLDER,
      nonce,
    },
    env.jwtSecret,
    { expiresIn: "1h" },
  );

  const tokenHash = createHash("sha256").update(uploadToken).digest("hex");

  await createMediaUploadAuthRecord({
    tokenHash,
    publicId,
    folder: AVATAR_FOLDER,
    adminId: userId,
    expiresAt: new Date((timestamp + 3600) * 1000),
  });

  return {
    signature,
    timestamp,
    apiKey: config.apiKey,
    cloudName: config.cloudName,
    folder: AVATAR_FOLDER,
    publicId,
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
    maxFileSize: AVATAR_MAX_BYTES,
    allowedFormats: AVATAR_ALLOWED_FORMATS,
    uploadToken,
  };
};

/**
 * Confirms uploaded avatar with Cloudinary, verifies image constraints, updates user profile,
 * and safely removes any previously managed avatar asset.
 */
export const confirmAvatarUpload = async (
  userId: string,
  input: ConfirmProfileAvatarInput,
): Promise<UserProfile> => {
  const cloudinary = getCloudinaryClient();

  // 1. Verify upload token
  let decoded: UploadTokenPayload;
  try {
    decoded = jwt.verify(input.uploadToken, env.jwtSecret) as UploadTokenPayload;
  } catch {
    throw new AppError("Invalid or expired upload authorization token", 400);
  }

  if (decoded.adminId !== userId) {
    throw new AppError("Upload authorization belongs to another user", 403);
  }

  const rawPublicId = input.publicId.replace(new RegExp(`^${AVATAR_FOLDER}/`), "");
  if (decoded.publicId !== input.publicId && decoded.publicId !== rawPublicId) {
    throw new AppError("Upload token does not match the provided publicId", 400);
  }

  const fullPublicId = input.publicId.startsWith(`${AVATAR_FOLDER}/`)
    ? input.publicId
    : `${AVATAR_FOLDER}/${input.publicId}`;

  // 1b. Verify single-use persisted authorization in DB (prevents replay attacks)
  let authRecord = await findMediaUploadAuthByPublicId(rawPublicId);
  if (!authRecord && fullPublicId !== rawPublicId) {
    authRecord = await findMediaUploadAuthByPublicId(fullPublicId);
  }
  if (!authRecord && input.publicId !== rawPublicId && input.publicId !== fullPublicId) {
    authRecord = await findMediaUploadAuthByPublicId(input.publicId);
  }

  if (!authRecord || authRecord.expiresAt < new Date()) {
    throw new AppError("Invalid or expired upload authorization token", 400);
  }

  if (authRecord.consumedAt) {
    throw new AppError("Upload authorization has already been consumed", 400);
  }

  if (authRecord.adminId !== userId) {
    throw new AppError("Upload authorization belongs to another user", 403);
  }

  // 2. Fetch asset details from Cloudinary
  let resource: any;
  try {
    resource = await cloudinary.api.resource(fullPublicId, {
      resource_type: "image",
    });
  } catch (err: any) {
    if (fullPublicId !== input.publicId) {
      try {
        resource = await cloudinary.api.resource(input.publicId, {
          resource_type: "image",
        });
      } catch {
        // continue
      }
    }
    if (!resource) {
      const status = err?.error?.http_code || err?.http_code;
      const msg = err?.error?.message || err?.message || "";
      if (status === 404 || /not found/i.test(msg)) {
        throw new AppError("Avatar image asset not found in Cloudinary", 404);
      }
      throw new AppError(
        `Failed to verify avatar with Cloudinary: ${msg || "Unknown error"}`,
        502,
      );
    }
  }

  // 3. Verify folder
  const isApprovedFolder =
    resource.folder === AVATAR_FOLDER ||
    (typeof resource.public_id === "string" &&
      resource.public_id.startsWith(`${AVATAR_FOLDER}/`));

  if (!isApprovedFolder) {
    throw new AppError(
      `Avatar outside approved folder. Assets must reside in ${AVATAR_FOLDER}.`,
      400,
    );
  }

  // 4. Verify format and size
  const format = String(resource.format || "").toLowerCase();
  const isAllowedFormat = (AVATAR_ALLOWED_FORMATS as readonly string[]).includes(format);
  if (!isAllowedFormat) {
    throw new AppError(
      `Unsupported image format: "${format || "unknown"}". Accepted formats are JPEG, PNG, and WebP.`,
      400,
    );
  }

  if (typeof resource.bytes === "number" && resource.bytes > AVATAR_MAX_BYTES) {
    throw new AppError(
      `Avatar file size exceeds the allowed limit of ${Math.round(AVATAR_MAX_BYTES / (1024 * 1024))} MB.`,
      400,
    );
  }

  // 5. Get current user avatar to clean up after successful update
  const currentUser = await userRepository.findUserByIdWithAvatar(userId);
  const previousAvatarKey = currentUser?.avatarKey;

  // 5b. Mark upload authorization as consumed
  await prisma.mediaUploadAuth.update({
    where: { id: authRecord.id },
    data: { consumedAt: new Date() },
  });

  // 6. Update user avatar
  const updatedProfile = await userRepository.updateProfile(userId, {
    avatarUrl: resource.secure_url,
    avatarKey: resource.public_id,
  });

  // 7. Clean up previous managed avatar if exists and different
  if (previousAvatarKey && previousAvatarKey !== resource.public_id) {
    try {
      await cloudinary.uploader.destroy(previousAvatarKey, {
        resource_type: "image",
        invalidate: true,
      });
    } catch {
      // Non-blocking cleanup error
    }
  }

  return updatedProfile;
};

/**
 * Removes own profile picture and deletes managed asset from Cloudinary.
 */
export const removeOwnAvatar = async (userId: string): Promise<UserProfile> => {
  const user = await userRepository.findUserByIdWithAvatar(userId);
  if (!user) {
    throw new AppError("User not found", 404);
  }

  const avatarKey = user.avatarKey;

  const updatedProfile = await userRepository.updateProfile(userId, {
    avatarUrl: null,
    avatarKey: null,
  });

  if (avatarKey) {
    try {
      const cloudinary = getCloudinaryClient();
      await cloudinary.uploader.destroy(avatarKey, {
        resource_type: "image",
        invalidate: true,
      });
    } catch {
      // Non-blocking cleanup
    }
  }

  return updatedProfile;
};
