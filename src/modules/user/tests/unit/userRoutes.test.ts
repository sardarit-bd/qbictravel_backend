import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../../../app.js";
import * as userService from "../../userService.js";

vi.mock("../../userService.js");

vi.mock("../../../../shared/middleware/authMiddleware.js", () => ({
  default: (req: any, _res: any, next: any) => {
    const role = (req.headers["x-mock-role"] as string) || "admin";
    const userId = (req.headers["x-mock-user-id"] as string) || "user-123";
    req.user = {
      id: userId,
      name: "Test User",
      email: "test@example.com",
      role,
    };
    next();
  },
}));

describe("User Profile & Avatar Endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("PUT /api/v1/users/me/email", () => {
    it("updates own email with valid payload", async () => {
      vi.mocked(userService.updateOwnEmail).mockResolvedValue({
        id: "user-123",
        name: "Test User",
        email: "newemail@example.com",
        phone: null,
        role: "customer",
        status: "active",
        avatarUrl: null,
        createdAt: new Date(),
      });

      const res = await request(app)
        .put("/api/v1/users/me/email")
        .send({
          newEmail: "newemail@example.com",
          currentPassword: "mySecretPassword123",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe("newemail@example.com");
      expect(userService.updateOwnEmail).toHaveBeenCalledWith("user-123", {
        newEmail: "newemail@example.com",
        currentPassword: "mySecretPassword123",
      });
    });

    it("rejects invalid email format", async () => {
      const res = await request(app)
        .put("/api/v1/users/me/email")
        .send({
          newEmail: "invalid-email-format",
          currentPassword: "password123",
        });

      expect(res.status).toBe(400);
      expect(userService.updateOwnEmail).not.toHaveBeenCalled();
    });

    it("rejects empty currentPassword", async () => {
      const res = await request(app)
        .put("/api/v1/users/me/email")
        .send({
          newEmail: "valid@example.com",
          currentPassword: "",
        });

      expect(res.status).toBe(400);
      expect(userService.updateOwnEmail).not.toHaveBeenCalled();
    });

    it("returns 409 when email is already in use", async () => {
      const AppError = (await import("../../../../shared/utils/AppError.js")).default;
      vi.mocked(userService.updateOwnEmail).mockRejectedValue(
        new AppError("Email address is already in use by another account", 409)
      );

      const res = await request(app)
        .put("/api/v1/users/me/email")
        .send({
          newEmail: "existing@example.com",
          currentPassword: "mySecretPassword123",
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already in use/i);
    });

    it("returns 401 when current password is invalid", async () => {
      const AppError = (await import("../../../../shared/utils/AppError.js")).default;
      vi.mocked(userService.updateOwnEmail).mockRejectedValue(
        new AppError("Invalid current password. Re-authentication failed.", 401)
      );

      const res = await request(app)
        .put("/api/v1/users/me/email")
        .send({
          newEmail: "valid@example.com",
          currentPassword: "wrongPassword",
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid current password/i);
    });

    it("returns 403 Forbidden for staff role", async () => {
      const res = await request(app)
        .put("/api/v1/users/me/email")
        .set("x-mock-role", "staff")
        .send({
          newEmail: "staffnew@example.com",
          currentPassword: "password123",
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(userService.updateOwnEmail).not.toHaveBeenCalled();
    });

    it("returns 403 Forbidden for agent role", async () => {
      const res = await request(app)
        .put("/api/v1/users/me/email")
        .set("x-mock-role", "agent")
        .send({
          newEmail: "agentnew@example.com",
          currentPassword: "password123",
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(userService.updateOwnEmail).not.toHaveBeenCalled();
    });

    it("returns 403 Forbidden for customer role", async () => {
      const res = await request(app)
        .put("/api/v1/users/me/email")
        .set("x-mock-role", "customer")
        .send({
          newEmail: "custnew@example.com",
          currentPassword: "password123",
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(userService.updateOwnEmail).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/v1/users/me/avatar/signature", () => {
    it("generates signed upload credentials for current user", async () => {
      vi.mocked(userService.generateAvatarUploadSignature).mockResolvedValue({
        uploadUrl: "https://api.cloudinary.com/v1_1/demo/image/upload",
        signature: "sig123",
        timestamp: 1234567890,
        apiKey: "key123",
        cloudName: "demo",
        maxFileSize: 5 * 1024 * 1024,
        allowedFormats: ["jpg", "jpeg", "png", "webp"],
        folder: "phukettours/avatars",
        publicId: "phukettours/avatars/user-123-token123",
        uploadToken: "token123",
      });

      const res = await request(app).post("/api/v1/users/me/avatar/signature");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.folder).toBe("phukettours/avatars");
      expect(userService.generateAvatarUploadSignature).toHaveBeenCalledWith("user-123");
    });
  });

  describe("POST /api/v1/users/me/avatar/confirm", () => {
    it("confirms avatar upload and updates profile", async () => {
      vi.mocked(userService.confirmAvatarUpload).mockResolvedValue({
        id: "user-123",
        name: "Test User",
        email: "test@example.com",
        phone: null,
        role: "customer",
        status: "active",
        avatarUrl: "https://res.cloudinary.com/demo/image/upload/v1/avatar.jpg",
        createdAt: new Date(),
      });

      const res = await request(app)
        .post("/api/v1/users/me/avatar/confirm")
        .send({
          uploadToken: "token-abc-123",
          publicId: "phukettours/avatars/user-123-token-abc-123",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.avatarUrl).toContain("avatar.jpg");
      expect(userService.confirmAvatarUpload).toHaveBeenCalledWith("user-123", {
        uploadToken: "token-abc-123",
        publicId: "phukettours/avatars/user-123-token-abc-123",
      });
    });

    it("rejects confirmation when publicId or uploadToken is missing", async () => {
      const res = await request(app)
        .post("/api/v1/users/me/avatar/confirm")
        .send({
          uploadToken: "token-abc-123",
        });

      expect(res.status).toBe(400);
      expect(userService.confirmAvatarUpload).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/v1/users/me/avatar", () => {
    it("removes user avatar", async () => {
      vi.mocked(userService.removeOwnAvatar).mockResolvedValue({
        id: "user-123",
        name: "Test User",
        email: "test@example.com",
        phone: null,
        role: "customer",
        status: "active",
        avatarUrl: null,
        createdAt: new Date(),
      });

      const res = await request(app).delete("/api/v1/users/me/avatar");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.avatarUrl).toBeNull();
      expect(userService.removeOwnAvatar).toHaveBeenCalledWith("user-123");
    });
  });
});
