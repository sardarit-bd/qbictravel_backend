import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import request from "supertest";
import { vi } from "vitest";
import app from "../app.js";
import { prisma } from "../lib/prisma.js";
import { sendEmail } from "../shared/utils/mailer.js";
import type { UserRole, UserStatus } from "../types/common.js";

export { prisma };

export const TEST_PASSWORD = "secret123";
const PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, 4);

export const api = () => request(app);

export const resetDatabase = async (): Promise<void> => {
  const dbPath = new URL(process.env.DATABASE_URL ?? "").pathname;

  if (!/test/i.test(dbPath)) {
    throw new Error(`Refusing to wipe a non-test database: ${dbPath}`);
  }

  await prisma.revokedToken.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.agentProfile.deleteMany();
  await prisma.user.deleteMany();
  vi.mocked(sendEmail).mockClear();
};

type UserOverrides = Partial<{
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
}>;

export const createUser = (overrides: UserOverrides = {}) =>
  prisma.user.create({
    data: {
      name: "Test User",
      email: `${randomUUID()}@example.com`,
      password: PASSWORD_HASH,
      ...overrides,
    },
  });

export const loginAgent = async (email: string) => {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/v1/auth/login")
    .send({ email, password: TEST_PASSWORD });

  if (res.status !== 200) {
    throw new Error(`Test login failed (${res.status}): ${res.text}`);
  }

  return agent;
};

export const tokenFromResponse = (res: request.Response): string => {
  const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const match = cookies.join(";").match(/token=([^;]+)/);

  if (!match) {
    throw new Error("No token cookie in response");
  }

  return match[1]!;
};

export const lastEmailToken = (): string => {
  const calls = vi.mocked(sendEmail).mock.calls;
  const text = calls[calls.length - 1]?.[0].text ?? "";
  const match = text.match(/token=([a-f0-9]{64})/);

  if (!match) {
    throw new Error("No reset token found in the last email");
  }

  return match[1]!;
};