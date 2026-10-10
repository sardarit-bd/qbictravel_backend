import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import requireRole from "../requireRole.js";

const run = (user: Request["user"], ...roles: Parameters<typeof requireRole>) => {
  const next = vi.fn();
  requireRole(...roles)({ user } as Request, {} as Response, next);
  return next.mock.calls[0]?.[0];
};

const make = (role: "customer" | "agent" | "staff" | "admin") => ({
  id: "u1",
  name: "Jane",
  email: "jane@example.com",
  role,
});

describe("requireRole", () => {
  it("returns 401 when there is no authenticated user", () => {
    expect(run(undefined, "admin")).toMatchObject({ statusCode: 401 });
  });

  it("returns 403 when the role is not allowed", () => {
    expect(run(make("customer"), "admin")).toMatchObject({ statusCode: 403 });
  });

  it("allows a permitted role", () => {
    expect(run(make("admin"), "admin")).toBeUndefined();
    expect(run(make("agent"), "agent", "admin")).toBeUndefined();
  });
});