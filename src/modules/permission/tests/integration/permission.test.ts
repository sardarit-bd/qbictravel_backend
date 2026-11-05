import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  api,
  createUser,
  loginAgent,
  prisma,
  resetDatabase,
} from "../../../../test/helpers.js";
import { ALL_PERMISSION_IDS } from "../../permissionConstants.js";

const PERMISSIONS_BASE = "/api/v1/admin/permissions";
const STAFF_PERM_BASE = "/api/v1/admin/staff";
const AUTH_PERM_BASE = "/api/v1/auth/me/permissions";

type Session = Awaited<ReturnType<typeof loginAgent>>;

let admin: Awaited<ReturnType<typeof createUser>>;
let adminSession: Session;
let staff: Awaited<ReturnType<typeof createUser>>;
let staffSession: Session;
let customer: Awaited<ReturnType<typeof createUser>>;
let customerSession: Session;
let agent: Awaited<ReturnType<typeof createUser>>;
let agentSession: Session;

beforeEach(async () => {
  await resetDatabase();

  admin = await createUser({ role: "admin", name: "Admin User" });
  adminSession = await loginAgent(admin.email);

  staff = await createUser({ role: "staff", name: "Staff Member" });
  staffSession = await loginAgent(staff.email);

  customer = await createUser({ role: "customer", name: "Regular Customer" });
  customerSession = await loginAgent(customer.email);

  agent = await createUser({ role: "agent", name: "Travel Agent" });
  agentSession = await loginAgent(agent.email);
});

afterAll(() => prisma.$disconnect());

describe("Permission Catalog API (GET /api/v1/admin/permissions)", () => {
  it("returns 401 without an authenticated session", async () => {
    const res = await api().get(PERMISSIONS_BASE);
    expect(res.status).toBe(401);
  });

  it.each(["customer", "agent", "staff"] as const)(
    "returns 403 for %s role attempting to access catalog",
    async (role) => {
      const session =
        role === "customer"
          ? customerSession
          : role === "agent"
          ? agentSession
          : staffSession;

      const res = await session.get(PERMISSIONS_BASE);
      expect(res.status).toBe(403);
    }
  );

  it("returns the complete verified permission catalog for admin", async () => {
    const res = await adminSession.get(PERMISSIONS_BASE);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalPermissions).toBe(ALL_PERMISSION_IDS.length);
    expect(Array.isArray(res.body.data.modules)).toBe(true);

    const moduleNames = res.body.data.modules.map((m: any) => m.module);
    expect(moduleNames).toContain("users");
    expect(moduleNames).toContain("tours");
    expect(moduleNames).toContain("bookings");
    expect(moduleNames).toContain("payments");
    expect(moduleNames).toContain("media");
    expect(moduleNames).toContain("reports");
    expect(moduleNames).toContain("dashboard");
  });
});

describe("Staff Permissions Management API", () => {
  it("returns 403 when a staff member attempts to view or assign staff permissions (self-escalation prevention)", async () => {
    // Staff cannot view permissions endpoint
    const getRes = await staffSession.get(
      `${STAFF_PERM_BASE}/${staff.id}/permissions`
    );
    expect(getRes.status).toBe(403);

    // Staff cannot assign permissions to themselves or others
    const putRes = await staffSession
      .put(`${STAFF_PERM_BASE}/${staff.id}/permissions`)
      .send({ permissions: ["users.view", "users.edit"] });
    expect(putRes.status).toBe(403);
  });

  it("returns 400 when trying to assign permissions to a non-staff user", async () => {
    const res = await adminSession
      .put(`${STAFF_PERM_BASE}/${customer.id}/permissions`)
      .send({ permissions: ["users.view"] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/staff accounts/i);
  });

  it("returns 400 when assigning invalid/unknown permission identifiers", async () => {
    const res = await adminSession
      .put(`${STAFF_PERM_BASE}/${staff.id}/permissions`)
      .send({ permissions: ["fake.delete_database", "users.view"] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid permission/i);
  });

  it("allows admin to assign, retrieve, and update staff permissions", async () => {
    // 1. Initial assigned permissions should be empty
    const initRes = await adminSession.get(
      `${STAFF_PERM_BASE}/${staff.id}/permissions`
    );
    expect(initRes.status).toBe(200);
    expect(initRes.body.data.permissions).toEqual([]);

    // 2. Assign users.view and tours.view
    const assignRes = await adminSession
      .put(`${STAFF_PERM_BASE}/${staff.id}/permissions`)
      .send({ permissions: ["users.view", "tours.view"] });
    expect(assignRes.status).toBe(200);
    expect(assignRes.body.data.permissions).toHaveLength(2);
    expect(assignRes.body.data.permissions).toContain("users.view");
    expect(assignRes.body.data.permissions).toContain("tours.view");

    // 3. Verify retrieval reflects the new assignments
    const getRes = await adminSession.get(
      `${STAFF_PERM_BASE}/${staff.id}/permissions`
    );
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.permissions).toEqual(["tours.view", "users.view"]);

    // 4. Update (replace) with only tours.view
    const updateRes = await adminSession
      .put(`${STAFF_PERM_BASE}/${staff.id}/permissions`)
      .send({ permissions: ["tours.view"] });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.permissions).toEqual(["tours.view"]);
  });
});

describe("Dynamic Authorization & Enforcement", () => {
  it("enforces permissions dynamically without server restart", async () => {
    // Staff initially has no permissions: /admin/users returns 403
    let res = await staffSession.get("/api/v1/admin/users");
    expect(res.status).toBe(403);

    // Admin grants users.view
    const grantRes = await adminSession
      .put(`${STAFF_PERM_BASE}/${staff.id}/permissions`)
      .send({ permissions: ["users.view"] });
    expect(grantRes.status).toBe(200);

    // Staff can now immediately access /admin/users
    res = await staffSession.get("/api/v1/admin/users");
    expect(res.status).toBe(200);

    // Staff still cannot access /admin/services (tours.view required)
    const toursRes = await staffSession.get("/api/v1/admin/services");
    expect(toursRes.status).toBe(403);

    // Admin revokes users.view
    await adminSession
      .put(`${STAFF_PERM_BASE}/${staff.id}/permissions`)
      .send({ permissions: [] });

    // Staff is immediately blocked again with 403
    res = await staffSession.get("/api/v1/admin/users");
    expect(res.status).toBe(403);
  });

  it("ensures Admin maintains unrestricted access regardless of explicit assignments", async () => {
    // Admin has access to all protected endpoints.
    // NOTE: The test database is not seeded with the full permission catalog,
    // so endpoints gated by requirePermission() for non-admin roles may return
    // 403 during integration tests. Admin bypass still applies to all endpoints
    // mounted with authMiddleware + requirePermission() in the real application.
    expect((await adminSession.get("/api/v1/admin/users")).status).toBe(200);
    expect((await adminSession.get("/api/v1/admin/services")).status).toBe(200);
    expect((await adminSession.get("/api/v1/admin/media")).status).toBe(200);
    expect((await adminSession.get("/api/v1/admin/reports/bookings")).status).toBe(200);
  });

  it("strictly isolates Customer and Agent from administrative operations", async () => {
    // Customer cannot access any admin routes
    expect((await customerSession.get("/api/v1/admin/users")).status).toBe(403);
    expect((await customerSession.get("/api/v1/admin/services")).status).toBe(403);
    expect((await customerSession.get("/api/v1/admin/payments")).status).toBe(403);

    // Agent cannot access admin routes
    expect((await agentSession.get("/api/v1/admin/users")).status).toBe(403);
    expect((await agentSession.get("/api/v1/admin/services")).status).toBe(403);
    expect((await agentSession.get("/api/v1/admin/payments")).status).toBe(403);
  });
});

describe("Effective Permissions (GET /api/v1/auth/me/permissions)", () => {
  it("returns 401 without authentication", async () => {
    const res = await api().get(AUTH_PERM_BASE);
    expect(res.status).toBe(401);
  });

  it("returns all permissions and isAdmin: true for an admin", async () => {
    const res = await adminSession.get(AUTH_PERM_BASE);
    expect(res.status).toBe(200);
    expect(res.body.data.isAdmin).toBe(true);
    expect(res.body.data.permissions).toEqual(ALL_PERMISSION_IDS);
  });

  it("returns explicitly assigned permissions and isAdmin: false for staff", async () => {
    // Before assignment
    let res = await staffSession.get(AUTH_PERM_BASE);
    expect(res.status).toBe(200);
    expect(res.body.data.isAdmin).toBe(false);
    expect(res.body.data.permissions).toEqual([]);

    // Assign permissions
    await adminSession
      .put(`${STAFF_PERM_BASE}/${staff.id}/permissions`)
      .send({ permissions: ["payments.view", "payments.verify"] });

    res = await staffSession.get(AUTH_PERM_BASE);
    expect(res.status).toBe(200);
    expect(res.body.data.isAdmin).toBe(false);
    expect(res.body.data.permissions).toEqual(["payments.verify", "payments.view"]);
  });

  it("returns empty permissions and isAdmin: false for customer and agent", async () => {
    const custRes = await customerSession.get(AUTH_PERM_BASE);
    expect(custRes.status).toBe(200);
    expect(custRes.body.data.isAdmin).toBe(false);
    expect(custRes.body.data.permissions).toEqual([]);

    const agentRes = await agentSession.get(AUTH_PERM_BASE);
    expect(agentRes.status).toBe(200);
    expect(agentRes.body.data.isAdmin).toBe(false);
    expect(agentRes.body.data.permissions).toEqual([]);
  });

  it("returns Cache-Control: no-store and avoids conditional 304 responses", async () => {
    const first = await adminSession.get(AUTH_PERM_BASE);

    expect(first.status).toBe(200);
    expect(first.headers["cache-control"]).toEqual("no-store");
    expect(first.headers["pragma"]).toEqual("no-cache");
    // The endpoint intentionally sends no ETag so a conditional 304 can never
    // be produced, even when a client sends If-None-Match/If-Modified-Since.
    expect(first.headers["etag"]).toBeUndefined();

    // Send a stale If-None-Match to confirm the endpoint still returns 200.
    const second = await adminSession
      .get(AUTH_PERM_BASE)
      .set("If-None-Match", `"stale-etag-${Math.random()}"`);

    expect(second.status).toBe(200);
    expect(second.headers["cache-control"]).toEqual("no-store");
    expect(second.headers["etag"]).toBeUndefined();
    expect(second.body.success).toBe(true);
    expect(second.body.data.isAdmin).toBe(true);
    expect(second.body.data.permissions).toEqual(ALL_PERMISSION_IDS);
  });

  it("returns Cache-Control: no-store and avoids conditional 304 responses", async () => {
    const first = await adminSession.get(AUTH_PERM_BASE);
    expect(first.status).toBe(200);
    expect(first.headers["cache-control"]).toEqual("no-store");
    expect(first.headers["pragma"]).toEqual("no-cache");
    // The endpoint intentionally sends no ETag so a conditional 304 can never
    // be produced, even when a client sends If-None-Match/If-Modified-Since.
    expect(first.headers["etag"]).toBeUndefined();

    // Send a stale If-None-Match to confirm the endpoint still returns 200.
    const second = await adminSession
      .get(AUTH_PERM_BASE)
      .set("If-None-Match", `"stale-etag-${Math.random()}"`);

    expect(second.status).toBe(200);
    expect(second.headers["cache-control"]).toEqual("no-store");
    expect(second.headers["etag"]).toBeUndefined();
    expect(second.body.success).toBe(true);
    expect(second.body.data.isAdmin).toBe(true);
    expect(second.body.data.permissions).toEqual(ALL_PERMISSION_IDS);
  });
});
