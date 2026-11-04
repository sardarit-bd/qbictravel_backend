import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import app from "../../../../app.js";
import * as adminService from "../../adminService.js";
import * as permissionRepository from "../../../permission/permissionRepository.js";

vi.mock("../../adminService.js");
vi.mock("../../../permission/permissionRepository.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../permission/permissionRepository.js")>();
  return { ...original };
});
vi.mock("../../../../shared/middleware/authMiddleware.js", () => ({
  default: (req: any, _res: any, next: any) => {
    const role = req.headers["x-mock-role"] as string;
    req.user = { id: `${role}-1`, role };
    next();
  },
}));

describe("resend invitation permission separation (integration)", () => {
  const AGENT_ID = "123e4567-e89b-12d3-a456-426614174021";
  const STAFF_ID = "123e4567-e89b-12d3-a456-426614174022";

  it("lets a staff member with users.invite_agent resend via /admin/users/:id", async () => {
    vi.mocked(adminService.resendInvitation).mockResolvedValue({ success: true, message: "Resent" });
    const impl = (_id: string, permId: string) =>
      Promise.resolve(permId === "users.invite_agent");
    vi.spyOn(permissionRepository, "checkStaffPermission").mockImplementation(impl);

    const res = await request(app)
      .post(`/api/v1/admin/users/${AGENT_ID}/resend-invitation`)
      .set("x-mock-role", "staff");
    console.log("STATUS:", res.status, "BODY:", JSON.stringify(res.body));
    expect(res.status).toBe(200);
    expect(adminService.resendInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ id: "staff-1", role: "staff" }),
      AGENT_ID,
    );
  });

  it("denies a staff member without users.invite_agent on /admin/users/:id", async () => {
    const impl = (_id: string, permId: string) =>
      Promise.resolve(permId === "users.invite_staff");
    vi.spyOn(permissionRepository, "checkStaffPermission").mockImplementation(impl);

    const res = await request(app)
      .post(`/api/v1/admin/users/${AGENT_ID}/resend-invitation`)
      .set("x-mock-role", "staff");
    expect(res.status).toBe(403);
    expect(adminService.resendInvitation).not.toHaveBeenCalled();
  });

  it("lets a staff member with users.invite_staff resend via /admin/staff/:id", async () => {
    vi.mocked(adminService.resendInvitation).mockResolvedValue({ success: true, message: "Resent" });
    const impl = (_id: string, permId: string) =>
      Promise.resolve(permId === "users.invite_staff");
    vi.spyOn(permissionRepository, "checkStaffPermission").mockImplementation(impl);

    const res = await request(app)
      .post(`/api/v1/admin/staff/${STAFF_ID}/resend-invitation`)
      .set("x-mock-role", "staff");
    expect(res.status).toBe(200);
    expect(adminService.resendInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ id: "staff-1", role: "staff" }),
      STAFF_ID,
    );
  });

  it("denies a staff member with only users.invite_agent on /admin/staff/:id", async () => {
    const impl = (_id: string, permId: string) =>
      Promise.resolve(permId === "users.invite_agent");
    vi.spyOn(permissionRepository, "checkStaffPermission").mockImplementation(impl);

    const res = await request(app)
      .post(`/api/v1/admin/staff/${STAFF_ID}/resend-invitation`)
      .set("x-mock-role", "staff");
    expect(res.status).toBe(403);
    expect(adminService.resendInvitation).not.toHaveBeenCalled();
  });
});
