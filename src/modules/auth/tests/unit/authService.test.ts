import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";
import * as authRepository from "../../authRepository.js";
import { sendEmail } from "../../../../shared/utils/mailer.js";
import {
  forgotPassword,
  loginUser,
  logoutUser,
  registerUser,
  resetPassword,
} from "../../authService.js";

vi.mock("../../authRepository.js");

const repo = vi.mocked(authRepository);

const PASSWORD = "secret123";
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

const activeUser = {
  id: "u1",
  name: "Jane",
  email: "jane@example.com",
  role: "customer" as const,
  status: "active" as const,
  tokenVersion: 3,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("registerUser", () => {
  it("always creates a customer and hashes the password", async () => {
    repo.findUserByEmail.mockResolvedValue(null);
    repo.createUser.mockResolvedValue({
      id: "u1",
      name: "Jane",
      email: "jane@example.com",
      role: "customer",
    });

    const result = await registerUser({
      name: "Jane",
      email: "jane@example.com",
      password: PASSWORD,
      role: "admin",
    } as never);

    const created = repo.createUser.mock.calls[0]![0];
    expect(created.role).toBe("customer");
    expect(created.password).not.toBe(PASSWORD);
    expect(await bcrypt.compare(PASSWORD, created.password)).toBe(true);

    const decoded = jwt.verify(
      result.token,
      process.env.JWT_SECRET!,
    ) as jwt.JwtPayload;
    expect(decoded).toMatchObject({ id: "u1", role: "customer", tv: 0 });
    expect(typeof decoded.jti).toBe("string");
  });

  it("rejects an existing email with 409", async () => {
    repo.findUserByEmail.mockResolvedValue(activeUser);

    await expect(
      registerUser({ name: "Jane", email: activeUser.email, password: PASSWORD }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(repo.createUser).not.toHaveBeenCalled();
  });

  it("maps a unique-constraint race to 409", async () => {
    repo.findUserByEmail.mockResolvedValue(null);
    repo.createUser.mockRejectedValue({ code: "P2002" });

    await expect(
      registerUser({ name: "Jane", email: activeUser.email, password: PASSWORD }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("loginUser", () => {
  it("returns a token carrying the token version", async () => {
    repo.findUserWithPassword.mockResolvedValue({
      ...activeUser,
      password: PASSWORD_HASH,
    });

    const result = await loginUser({ email: activeUser.email, password: PASSWORD });

    expect(result.user).toEqual({
      id: "u1",
      name: "Jane",
      email: "jane@example.com",
      role: "customer",
    });
    const decoded = jwt.verify(
      result.token,
      process.env.JWT_SECRET!,
    ) as jwt.JwtPayload;
    expect(decoded.tv).toBe(3);
  });

  it("returns the same 401 for unknown email and wrong password", async () => {
    repo.findUserWithPassword.mockResolvedValue(null);
    const unknown = await loginUser({
      email: "nobody@example.com",
      password: PASSWORD,
    }).catch((e) => e);

    repo.findUserWithPassword.mockResolvedValue({
      ...activeUser,
      password: PASSWORD_HASH,
    });
    const wrong = await loginUser({
      email: activeUser.email,
      password: "wrong-password",
    }).catch((e) => e);

    expect(unknown).toMatchObject({ statusCode: 401 });
    expect(wrong).toMatchObject({ statusCode: 401 });
    expect(unknown.message).toBe(wrong.message);
  });

  it("rejects a deactivated account with 403 after the password check", async () => {
    repo.findUserWithPassword.mockResolvedValue({
      ...activeUser,
      status: "deactivated",
      password: PASSWORD_HASH,
    });

    await expect(
      loginUser({ email: activeUser.email, password: PASSWORD }),
    ).rejects.toMatchObject({ statusCode: 403 });

    await expect(
      loginUser({ email: activeUser.email, password: "wrong-password" }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});

describe("logoutUser", () => {
  it("revokes the token until its expiry", async () => {
    await logoutUser({ jti: "j1", exp: 1_900_000_000 });

    expect(repo.revokeToken).toHaveBeenCalledWith(
      "j1",
      new Date(1_900_000_000 * 1000),
    );
    expect(repo.deleteExpiredRevokedTokens).toHaveBeenCalled();
  });
});

describe("forgotPassword", () => {
  it("stores only a hash of the emailed token", async () => {
    repo.findUserByEmail.mockResolvedValue(activeUser);

    await forgotPassword({ email: activeUser.email });

    const stored = repo.replacePasswordResetToken.mock.calls[0]![0];
    const mail = vi.mocked(sendEmail).mock.calls[0]![0];
    const token = mail.text.match(/token=([a-f0-9]{64})/)![1]!;

    expect(mail.to).toBe(activeUser.email);
    expect(stored.userId).toBe("u1");
    expect(stored.tokenHash).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("does nothing and does not throw for an unknown email", async () => {
    repo.findUserByEmail.mockResolvedValue(null);

    await expect(
      forgotPassword({ email: "nobody@example.com" }),
    ).resolves.toBeUndefined();
    expect(repo.replacePasswordResetToken).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends nothing for a deactivated account", async () => {
    repo.findUserByEmail.mockResolvedValue({
      ...activeUser,
      status: "deactivated",
    });

    await forgotPassword({ email: activeUser.email });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("swallows internal failures so the response stays generic", async () => {
    repo.findUserByEmail.mockResolvedValue(activeUser);
    repo.replacePasswordResetToken.mockRejectedValue(new Error("db down"));

    await expect(
      forgotPassword({ email: activeUser.email }),
    ).resolves.toBeUndefined();
  });
});

describe("resetPassword", () => {
  it("looks the token up by hash and updates the password", async () => {
    repo.findActivePasswordResetToken.mockResolvedValue({
      id: "t1",
      userId: "u1",
      userStatus: "active",
    });
    repo.resetPasswordWithToken.mockResolvedValue(true);

    await resetPassword({ token: "raw-token", password: "newSecret456" });

    expect(repo.findActivePasswordResetToken).toHaveBeenCalledWith(
      createHash("sha256").update("raw-token").digest("hex"),
    );
    const update = repo.resetPasswordWithToken.mock.calls[0]![0];
    expect(update).toMatchObject({ tokenId: "t1", userId: "u1" });
    expect(await bcrypt.compare("newSecret456", update.passwordHash)).toBe(true);
  });

  it("rejects an unknown, used or expired token with 400", async () => {
    repo.findActivePasswordResetToken.mockResolvedValue(null);

    await expect(
      resetPassword({ token: "bad", password: "newSecret456" }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a token whose owner is deactivated", async () => {
    repo.findActivePasswordResetToken.mockResolvedValue({
      id: "t1",
      userId: "u1",
      userStatus: "deactivated",
    });

    await expect(
      resetPassword({ token: "raw-token", password: "newSecret456" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(repo.resetPasswordWithToken).not.toHaveBeenCalled();
  });

  it("rejects when the token was consumed concurrently", async () => {
    repo.findActivePasswordResetToken.mockResolvedValue({
      id: "t1",
      userId: "u1",
      userStatus: "active",
    });
    repo.resetPasswordWithToken.mockResolvedValue(false);

    await expect(
      resetPassword({ token: "raw-token", password: "newSecret456" }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});