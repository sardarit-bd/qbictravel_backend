import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TEST_PASSWORD,
  api,
  createUser,
  lastEmailToken,
  loginAgent,
  prisma,
  resetDatabase,
} from "../../../../test/helpers.js";
import { sendEmail } from "../../../../shared/utils/mailer.js";

const ADMIN = "/api/v1/admin";

type Session = Awaited<ReturnType<typeof loginAgent>>;
let admin: Awaited<ReturnType<typeof createUser>>;
let adminSession: Session;

beforeEach(async () => {
  await resetDatabase();
  admin = await createUser({ role: "admin", name: "Admin" });
  adminSession = await loginAgent(admin.email);
});
afterAll(() => prisma.$disconnect());

describe("access control", () => {
  it("returns 401 without a session", async () => {
    const res = await api().get(`${ADMIN}/users`);
    expect(res.status).toBe(401);
  });

  it.each(["customer", "agent", "staff"] as const)(
    "returns 403 for a %s on read and write routes",
    async (role) => {
      const user = await createUser({ role });
      const session = await loginAgent(user.email);

      expect((await session.get(`${ADMIN}/users`)).status).toBe(403);
      expect(
        (
          await session
            .post(`${ADMIN}/agents`)
            .send({ name: "A", email: "a@example.com" })
        ).status,
      ).toBe(403);
    },
  );

  it("blocks a deactivated admin", async () => {
    await prisma.user.update({
      where: { id: admin.id },
      data: { status: "deactivated" },
    });

    const res = await adminSession.get(`${ADMIN}/users`);
    expect(res.status).toBe(403);
  });
});

describe("GET /admin/users", () => {
  beforeEach(async () => {
    await createUser({ name: "Alice", email: "alice@example.com" });
    await createUser({ name: "Bob", email: "bob@example.com" });
    await createUser({ name: "Carol", email: "carol@example.com", role: "agent" });
  });

  it("lists users with pagination and no password field", async () => {
    const res = await adminSession.get(`${ADMIN}/users?limit=2&page=1`);

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.pagination).toEqual({
      page: 1,
      limit: 2,
      total: 4,
      totalPages: 2,
    });
    expect(JSON.stringify(res.body)).not.toContain("password");
  });

  it("searches by name or email, case-insensitively", async () => {
    const res = await adminSession.get(`${ADMIN}/users?search=ALI`);

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].name).toBe("Alice");
  });

  it("filters by role", async () => {
    const res = await adminSession.get(`${ADMIN}/users?role=agent`);

    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].role).toBe("agent");
  });

  it.each(["role=owner", "limit=1000", "page=0", "status=banned"])(
    "returns 400 for ?%s",
    async (query) => {
      const res = await adminSession.get(`${ADMIN}/users?${query}`);
      expect(res.status).toBe(400);
    },
  );
});

describe("GET /admin/users/:userId", () => {
  it("returns a user", async () => {
    const user = await createUser({ name: "Alice" });

    const res = await adminSession.get(`${ADMIN}/users/${user.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: user.id, name: "Alice" });
  });

  it("returns 404 for an unknown id and 400 for a malformed id", async () => {
    expect((await adminSession.get(`${ADMIN}/users/${randomUUID()}`)).status).toBe(404);
    expect((await adminSession.get(`${ADMIN}/users/not-a-uuid`)).status).toBe(400);
  });
});

describe("PATCH /admin/users/:userId", () => {
  it("updates name and phone", async () => {
    const user = await createUser();

    const res = await adminSession
      .patch(`${ADMIN}/users/${user.id}`)
      .send({ name: "Renamed", phone: "+8801700000000" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: "Renamed", phone: "+8801700000000" });
  });

  it("deactivation blocks the user's existing session and login, reactivation restores it", async () => {
    const user = await createUser();
    const session = await loginAgent(user.email);

    const off = await adminSession
      .patch(`${ADMIN}/users/${user.id}`)
      .send({ status: "deactivated" });
    expect(off.status).toBe(200);

    expect((await session.get("/api/v1/auth/me")).status).toBe(403);
    expect(
      (
        await api()
          .post("/api/v1/auth/login")
          .send({ email: user.email, password: TEST_PASSWORD })
      ).status,
    ).toBe(403);

    await adminSession.patch(`${ADMIN}/users/${user.id}`).send({ status: "active" });
    expect(
      (
        await api()
          .post("/api/v1/auth/login")
          .send({ email: user.email, password: TEST_PASSWORD })
      ).status,
    ).toBe(200);
  });

  it("does not allow changing the role", async () => {
    const user = await createUser();

    const res = await adminSession
      .patch(`${ADMIN}/users/${user.id}`)
      .send({ name: "Same Role", role: "admin" });

    expect(res.status).toBe(200);
    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored?.role).toBe("customer");

    const onlyRole = await adminSession
      .patch(`${ADMIN}/users/${user.id}`)
      .send({ role: "admin" });
    expect(onlyRole.status).toBe(400);
  });

  it("prevents an admin from deactivating themselves", async () => {
    const res = await adminSession
      .patch(`${ADMIN}/users/${admin.id}`)
      .send({ status: "deactivated" });

    expect(res.status).toBe(400);
    const stored = await prisma.user.findUnique({ where: { id: admin.id } });
    expect(stored?.status).toBe("active");
  });

  it("returns 400 for an invalid status and 404 for an unknown user", async () => {
    const user = await createUser();

    expect(
      (await adminSession.patch(`${ADMIN}/users/${user.id}`).send({ status: "banned" }))
        .status,
    ).toBe(400);
    expect(
      (await adminSession.patch(`${ADMIN}/users/${randomUUID()}`).send({ name: "X" }))
        .status,
    ).toBe(404);
  });
});

describe("agents", () => {
  it("creates an agent, emails a setup link and never exposes the password", async () => {
    const res = await adminSession.post(`${ADMIN}/agents`).send({
      name: "Sky Agent",
      email: "Sky@Example.com",
      phone: "+8801700000000",
      agencyName: "Sky Travels",
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      email: "sky@example.com",
      role: "agent",
      agentProfile: { agencyName: "Sky Travels" },
    });
    expect(JSON.stringify(res.body)).not.toContain("password");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmail).mock.calls[0]![0].to).toBe("sky@example.com");
  });

  it("lets the new agent set a password from the emailed link and log in", async () => {
    await adminSession
      .post(`${ADMIN}/agents`)
      .send({ name: "Sky Agent", email: "sky@example.com" });
    const token = lastEmailToken();

    const reset = await api()
      .post("/api/v1/auth/reset-password")
      .send({ token, password: "agentPass123" });
    expect(reset.status).toBe(200);

    const login = await api()
      .post("/api/v1/auth/login")
      .send({ email: "sky@example.com", password: "agentPass123" });
    expect(login.status).toBe(200);
    expect(login.body.data.role).toBe("agent");
  });

  it("returns 409 for a duplicate email and 400 for invalid input", async () => {
    const existing = await createUser();

    expect(
      (
        await adminSession
          .post(`${ADMIN}/agents`)
          .send({ name: "Dup", email: existing.email })
      ).status,
    ).toBe(409);
    expect(
      (await adminSession.post(`${ADMIN}/agents`).send({ name: "No Email" })).status,
    ).toBe(400);
    expect(
      (
        await adminSession
          .post(`${ADMIN}/agents`)
          .send({ email: "a@example.com" })
      ).status,
    ).toBe(400);
  });

  it("lists only agents and views a single agent", async () => {
    const agent = await createUser({ role: "agent", name: "Agent One" });
    await createUser({ role: "customer" });

    const list = await adminSession.get(`${ADMIN}/agents`);
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0].id).toBe(agent.id);

    const one = await adminSession.get(`${ADMIN}/agents/${agent.id}`);
    expect(one.status).toBe(200);
    expect(one.body.data.role).toBe("agent");
  });

  it("returns 404 when the id belongs to a non-agent", async () => {
    const customer = await createUser();

    expect((await adminSession.get(`${ADMIN}/agents/${customer.id}`)).status).toBe(404);
    expect(
      (
        await adminSession
          .patch(`${ADMIN}/agents/${customer.id}`)
          .send({ name: "X" })
      ).status,
    ).toBe(404);
  });

  it("updates agency name and status", async () => {
    const agent = await createUser({ role: "agent" });

    const res = await adminSession
      .patch(`${ADMIN}/agents/${agent.id}`)
      .send({ agencyName: "New Agency", status: "deactivated" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: "deactivated",
      agentProfile: { agencyName: "New Agency" },
    });
  });

  it("returns 400 for an empty update", async () => {
    const agent = await createUser({ role: "agent" });

    const res = await adminSession.patch(`${ADMIN}/agents/${agent.id}`).send({});
    expect(res.status).toBe(400);
  });
});

describe("staff", () => {
  it("creates a staff account without an agent profile", async () => {
    const res = await adminSession
      .post(`${ADMIN}/staff`)
      .send({ name: "Ops One", email: "ops@example.com" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      role: "staff",
      agentProfile: null,
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("returns 409 for a duplicate email", async () => {
    const existing = await createUser({ role: "staff" });

    const res = await adminSession
      .post(`${ADMIN}/staff`)
      .send({ name: "Dup", email: existing.email });
    expect(res.status).toBe(409);
  });

  it("lists only staff", async () => {
    const staff = await createUser({ role: "staff" });
    await createUser({ role: "agent" });

    const res = await adminSession.get(`${ADMIN}/staff`);

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].id).toBe(staff.id);
  });

  it("deactivating staff blocks their protected operations immediately", async () => {
    const staff = await createUser({ role: "staff" });
    const session = await loginAgent(staff.email);
    expect((await session.get("/api/v1/users/me")).status).toBe(200);

    const res = await adminSession
      .patch(`${ADMIN}/staff/${staff.id}`)
      .send({ status: "deactivated" });
    expect(res.status).toBe(200);

    expect((await session.get("/api/v1/users/me")).status).toBe(403);
  });

  it("returns 404 when the id belongs to a non-staff user", async () => {
    const agent = await createUser({ role: "agent" });

    const res = await adminSession
      .patch(`${ADMIN}/staff/${agent.id}`)
      .send({ name: "X" });
    expect(res.status).toBe(404);
  });
});