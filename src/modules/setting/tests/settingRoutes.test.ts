import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import app from "../../../app.js";
import * as settingService from "../settingService.js";
import * as permissionRepository from "../../permission/permissionRepository.js";

vi.mock("../settingService.js");
vi.mock("../../permission/permissionRepository.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../permission/permissionRepository.js")>();
  return { ...original };
});

vi.mock("../../../shared/middleware/authMiddleware.js", () => ({
  default: (req: any, _res: any, next: any) => {
    const role = (req.headers["x-mock-role"] as string) || "admin";
    req.user = {
      id: `${role}-1`,
      name: `${role} user`,
      email: `${role}@phukettours.local`,
      role,
    };
    next();
  },
}));

describe("Settings Routes & Removed Audit Logs Tests", () => {
  it("GET /api/v1/admin/settings/audit is removed and returns 404", async () => {
    const res = await request(app)
      .get("/api/v1/admin/settings/audit")
      .set("x-mock-role", "admin");

    expect(res.status).toBe(404);
  });

  it("GET /api/v1/admin/settings/audit-logs is removed and returns 404", async () => {
    const res = await request(app)
      .get("/api/v1/admin/settings/audit-logs")
      .set("x-mock-role", "admin");

    expect(res.status).toBe(404);
  });

  it("GET /api/v1/admin/settings allows admin access", async () => {
    vi.mocked(settingService.getSettingsOverview).mockResolvedValue({
      general: {} as any,
      payment: {} as any,
      webhook: {} as any,
      cloudinary: {} as any,
      smtp: {} as any,
      serverTime: new Date().toISOString(),
    });

    const res = await request(app)
      .get("/api/v1/admin/settings")
      .set("x-mock-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("PUT /api/v1/admin/settings/payment allows admin to update payment settings", async () => {
    vi.mocked(settingService.updatePaymentSettings).mockResolvedValue({} as any);

    const res = await request(app)
      .put("/api/v1/admin/settings/payment")
      .set("x-mock-role", "admin")
      .send({
        activeProvider: "stripe",
        stripe: {
          publishableKey: "pk_test_sample",
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("GET /api/v1/admin/settings denies customer and agent roles", async () => {
    const resCustomer = await request(app)
      .get("/api/v1/admin/settings")
      .set("x-mock-role", "customer");
    expect(resCustomer.status).toBe(403);

    const resAgent = await request(app)
      .get("/api/v1/admin/settings")
      .set("x-mock-role", "agent");
    expect(resAgent.status).toBe(403);
  });
});
