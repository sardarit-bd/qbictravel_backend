import dotenv from "dotenv";
import { vi } from "vitest";

dotenv.config({ path: ".env.test", override: true, quiet: true });
console.log("Vitest DB config:", {
  user: process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).username
    : "UNSET",
  database: process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).pathname
    : "UNSET",
});
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.JWT_SECRET ||= "test-jwt-secret";
process.env.DATABASE_URL ||=
  "postgresql://postgres:postgres@localhost:5432/travel_test";

vi.mock("./src/shared/logger/logger.js", async () => {
  const { default: pino } = await import("pino");
  return { default: pino({ level: "silent" }) };
});

vi.mock("./src/shared/utils/mailer.js", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));