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

describe("Settings Audit & Access Route Integration Tests", () => {
  const mockAuditResponse = {
    logs: [
      {
        id: "log-1",
        category: "GENERAL",
        action: "UPDATE_GENERAL_SETTINGS",
        status: "SUCCESS",
        actorId: "admin-1",
        actorName: "Platform Admin",
        actorEmail: "admin@phukettours.local",
        ipAddress: "127.0.0.1",
        userAgent: "TestAgent",
        metadata: { platformName: "PhuketTours" },
        createdAt: new Date().toISOString(),
      },
    ],
    pagination: {
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    },
  };

  it("GET /api/v1/admin/settings/audit allows admin access", async () => {
    vi.mocked(settingService.getAuditLogs).mockResolvedValue(mockAuditResponse as any);

    const res = await request(app)
      .get("/api/v1/admin/settings/audit")
      .set("x-mock-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.logs).toHaveLength(1);
    expect(res.body.data.logs[0].action).toBe("UPDATE_GENERAL_SETTINGS");
  });

  it("GET /api/v1/admin/settings/audit-logs also allows admin access", async () => {
    vi.mocked(settingService.getAuditLogs).mockResolvedValue(mockAuditResponse as any);

    const res = await request(app)
      .get("/api/v1/admin/settings/audit-logs")
      .set("x-mock-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.logs).toHaveLength(1);
  });

  it("GET /api/v1/admin/settings/audit allows staff with settings.audit.view permission", async () => {
    vi.mocked(settingService.getAuditLogs).mockResolvedValue(mockAuditResponse as any);
    vi.spyOn(permissionRepository, "checkStaffPermission").mockImplementation(
      (_userId, permId) => Promise.resolve(permId === "settings.audit.view")
    );

    const res = await request(app)
      .get("/api/v1/admin/settings/audit")
      .set("x-mock-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("GET /api/v1/admin/settings/audit denies staff without settings.audit.view or settings.view", async () => {
    vi.spyOn(permissionRepository, "checkStaffPermission").mockResolvedValue(false);

    const res = await request(app)
      .get("/api/v1/admin/settings/audit")
      .set("x-mock-role", "staff");

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("GET /api/v1/admin/settings/audit denies customer and agent roles", async () => {
    const resCustomer = await request(app)
      .get("/api/v1/admin/settings/audit")
      .set("x-mock-role", "customer");
    expect(resCustomer.status).toBe(403);

    const resAgent = await request(app)
      .get("/api/v1/admin/settings/audit")
      .set("x-mock-role", "agent");
    expect(resAgent.status).toBe(403);
  });
});

