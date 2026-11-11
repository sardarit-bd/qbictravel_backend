import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import env from "../../../../config/env.js";
import AppError from "../../../../shared/utils/AppError.js";
import * as userRepository from "../../userRepository.js";
import * as authRepository from "../../../auth/authRepository.js";
import { prisma } from "../../../../lib/prisma.js";
import { cloudinary } from "../../../../config/cloudinary.js";
import {
  updateOwnEmail,
  generateAvatarUploadSignature,
  confirmAvatarUpload,
  removeOwnAvatar,
} from "../../userService.js";

vi.mock("../../userRepository.js");
vi.mock("../../../auth/authRepository.js");
vi.mock("../../../../lib/prisma.js", () => ({
  prisma: {
    mediaUploadAuth: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));
const { mockCloudinary } = vi.hoisted(() => {
  const m = {
    utils: {
      api_sign_request: vi.fn(() => "mock-cloudinary-signature"),
    },
    api: {
      resource: vi.fn(),
    },
    uploader: {
      destroy: vi.fn().mockResolvedValue({ result: "ok" }),
    },
    config: vi.fn(),
  };
  return { mockCloudinary: m };
});

vi.mock("../../../../config/cloudinary.js", () => ({
  default: mockCloudinary,
  cloudinary: mockCloudinary,
  getCloudinaryClient: vi.fn(() => mockCloudinary),
  getCloudinaryConfig: vi.fn(() => ({
    cloudName: "demo",
    apiKey: "key123",
    apiSecret: "sec123",
  })),
  isCloudinaryConfigured: vi.fn(() => true),
  ensureCloudinaryConfigured: vi.fn(),
}));

describe("userService Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("updateOwnEmail", () => {
    const userId = "usr-uuid-1";
    const currentPassword = "Password123!";
    const hashedPassword = bcrypt.hashSync(currentPassword, 4);

    it("successfully updates email when current password matches and email is unique", async () => {
      vi.mocked(authRepository.findUserWithPasswordById).mockResolvedValue({
        id: userId,
        password: hashedPassword,
        email: "old@example.com",
      } as any);

      vi.mocked(userRepository.findUserByEmail).mockResolvedValue(null);

      vi.mocked(userRepository.updateEmail).mockResolvedValue({
        id: userId,
        name: "Test User",
        email: "new@example.com",
        phone: null,
        role: "admin",
        status: "active",
        avatarUrl: null,
        createdAt: new Date(),
      });

      const result = await updateOwnEmail(userId, {
        newEmail: "new@example.com",
        currentPassword,
      });

      expect(result.email).toBe("new@example.com");
      expect(userRepository.updateEmail).toHaveBeenCalledWith(userId, "new@example.com");
    });

    it("throws 401 when user password does not match", async () => {
      vi.mocked(authRepository.findUserWithPasswordById).mockResolvedValue({
        id: userId,
        password: hashedPassword,
        email: "old@example.com",
      } as any);

      await expect(
        updateOwnEmail(userId, {
          newEmail: "new@example.com",
          currentPassword: "wrongPassword",
        })
      ).rejects.toThrow(/invalid current password/i);
    });

    it("throws 409 when new email is already in use by another account", async () => {
      vi.mocked(authRepository.findUserWithPasswordById).mockResolvedValue({
        id: userId,
        password: hashedPassword,
        email: "old@example.com",
      } as any);

      vi.mocked(userRepository.findUserByEmail).mockResolvedValue({
        id: "other-user-uuid",
        email: "existing@example.com",
      } as any);

      await expect(
        updateOwnEmail(userId, {
          newEmail: "existing@example.com",
          currentPassword,
        })
      ).rejects.toThrow(/already in use/i);
    });

    it("throws 400 when new email is identical to current email", async () => {
      vi.mocked(authRepository.findUserWithPasswordById).mockResolvedValue({
        id: userId,
        password: hashedPassword,
        email: "same@example.com",
      } as any);

      await expect(
        updateOwnEmail(userId, {
          newEmail: "same@example.com",
          currentPassword,
        })
      ).rejects.toThrow(/different from current email/i);
    });
  });

  describe("generateAvatarUploadSignature", () => {
    it("generates signed upload params and records token in MediaUploadAuth", async () => {
      const userId = "usr-avatar-1";
      vi.mocked(prisma.mediaUploadAuth.create).mockResolvedValue({
        id: "mua-1",
        adminId: userId,
        tokenHash: "tok-1",
        publicId: "phukettours/avatars/usr-avatar-1-tok-1",
        folder: "phukettours/avatars",
        consumedAt: null,
        expiresAt: new Date(),
        createdAt: new Date(),
      });

      const res = await generateAvatarUploadSignature(userId);

      expect(res.folder).toBe("phukettours/avatars");
      expect(res.signature).toBe("mock-cloudinary-signature");
      expect(prisma.mediaUploadAuth.create).toHaveBeenCalled();
    });
  });

  describe("confirmAvatarUpload", () => {
    const userId = "usr-avatar-1";
    const publicId = "phukettours/avatars/usr-avatar-1-tok-123";
    const uploadToken = jwt.sign(
      { adminId: userId, publicId, folder: "phukettours/avatars" },
      env.jwtSecret,
      { expiresIn: "15m" }
    );

    it("confirms valid upload and cleans up previous avatar asset", async () => {
      vi.mocked(prisma.mediaUploadAuth.findUnique).mockResolvedValue({
        id: "mua-1",
        userId,
        adminId: userId,
        tokenHash: "hash123",
        publicId,
        folder: "phukettours/avatars",
        consumedAt: null,
        expiresAt: new Date(Date.now() + 100000),
        createdAt: new Date(),
      } as any);

      vi.mocked(mockCloudinary.api.resource).mockResolvedValue({
        public_id: publicId,
        folder: "phukettours/avatars",
        format: "jpg",
        bytes: 1024 * 500, // 500KB
        secure_url: `https://res.cloudinary.com/demo/image/upload/v1/${publicId}.jpg`,
      } as any);

      vi.mocked(userRepository.findUserByIdWithAvatar).mockResolvedValue({
        id: userId,
        avatarUrl: "https://res.cloudinary.com/demo/image/upload/v1/old-avatar.jpg",
        avatarKey: "phukettours/avatars/old-avatar-key",
      } as any);

      vi.mocked(userRepository.updateProfile).mockResolvedValue({
        id: userId,
        name: "Test",
        email: "test@example.com",
        phone: null,
        role: "admin",
        status: "active",
        avatarUrl: `https://res.cloudinary.com/demo/image/upload/v1/${publicId}.jpg`,
        createdAt: new Date(),
      });

      const result = await confirmAvatarUpload(userId, {
        uploadToken,
        publicId,
      });

      expect(result.avatarUrl).toContain(publicId);
      expect(prisma.mediaUploadAuth.update).toHaveBeenCalledWith({
        where: { id: "mua-1" },
        data: { consumedAt: expect.any(Date) },
      });
      // Verifies old avatar is safely cleaned up
      expect(mockCloudinary.uploader.destroy).toHaveBeenCalledWith("phukettours/avatars/old-avatar-key", {
        invalidate: true,
        resource_type: "image",
      });
    });

    it("rejects token when expired or already used", async () => {
      vi.mocked(prisma.mediaUploadAuth.findUnique).mockResolvedValue({
        id: "mua-1",
        userId,
        adminId: userId,
        tokenHash: "hash123",
        publicId,
        folder: "phukettours/avatars",
        consumedAt: new Date(), // Already consumed
        expiresAt: new Date(Date.now() + 100000),
        createdAt: new Date(),
      } as any);

      await expect(
        confirmAvatarUpload(userId, {
          uploadToken,
          publicId,
        })
      ).rejects.toThrow("Upload authorization has already been consumed");
    });

    it("rejects avatar when file size exceeds 5MB", async () => {
      vi.mocked(prisma.mediaUploadAuth.findUnique).mockResolvedValue({
        id: "mua-1",
        userId,
        adminId: userId,
        tokenHash: "hash123",
        publicId,
        folder: "phukettours/avatars",
        consumedAt: null,
        expiresAt: new Date(Date.now() + 100000),
        createdAt: new Date(),
      } as any);

      vi.mocked(mockCloudinary.api.resource).mockResolvedValue({
        public_id: publicId,
        folder: "phukettours/avatars",
        format: "jpg",
        bytes: 6 * 1024 * 1024, // 6MB
        secure_url: `https://res.cloudinary.com/demo/image/upload/v1/${publicId}.jpg`,
      } as any);

      await expect(
        confirmAvatarUpload(userId, {
          uploadToken,
          publicId,
        })
      ).rejects.toThrow(/file size exceeds/i);
    });
  });

  describe("removeOwnAvatar", () => {
    const userId = "usr-avatar-1";

    it("clears avatar in DB and destroys Cloudinary asset", async () => {
      vi.mocked(userRepository.findUserByIdWithAvatar).mockResolvedValue({
        id: userId,
        avatarUrl: "https://res.cloudinary.com/demo/image/upload/v1/avatar.jpg",
        avatarKey: "phukettours/avatars/avatar-to-delete",
      } as any);

      vi.mocked(userRepository.updateProfile).mockResolvedValue({
        id: userId,
        name: "Test",
        email: "test@example.com",
        phone: null,
        role: "admin",
        status: "active",
        avatarUrl: null,
        createdAt: new Date(),
      });

      const res = await removeOwnAvatar(userId);

      expect(res.avatarUrl).toBeNull();
      expect(userRepository.updateProfile).toHaveBeenCalledWith(userId, {
        avatarUrl: null,
        avatarKey: null,
      });
      expect(mockCloudinary.uploader.destroy).toHaveBeenCalledWith("phukettours/avatars/avatar-to-delete", {
        invalidate: true,
        resource_type: "image",
      });
    });
  });
});
