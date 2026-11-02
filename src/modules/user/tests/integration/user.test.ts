import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  api,
  createUser,
  loginAgent,
  prisma,
  resetDatabase,
} from "../../../../test/helpers.js";

const ME = "/api/v1/users/me";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe("GET /users/me", () => {
  it("returns 401 without a session", async () => {
    const res = await api().get(ME);
    expect(res.status).toBe(401);
  });

  it("returns the own profile", async () => {
    const user = await createUser({ name: "Jane", phone: "+8801700000000" });
    const agent = await loginAgent(user.email);

    const res = await agent.get(ME);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: user.id,
      name: "Jane",
      phone: "+8801700000000",
      role: "customer",
    });
    expect(res.body.data.password).toBeUndefined();
  });

  it("returns 403 for a deactivated account with an existing session", async () => {
    const user = await createUser();
    const agent = await loginAgent(user.email);
    await prisma.user.update({
      where: { id: user.id },
      data: { status: "deactivated" },
    });

    const res = await agent.get(ME);
    expect(res.status).toBe(403);
  });
});

describe("PATCH /users/me", () => {
  it("returns 401 without a session", async () => {
    const res = await api().patch(ME).send({ name: "X" });
    expect(res.status).toBe(401);
  });

  it("updates name and phone", async () => {
    const user = await createUser();
    const agent = await loginAgent(user.email);

    const res = await agent
      .patch(ME)
      .send({ name: "New Name", phone: "+8801711111111" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: "New Name",
      phone: "+8801711111111",
    });
  });

  it("clears the phone with null", async () => {
    const user = await createUser({ phone: "+8801700000000" });
    const agent = await loginAgent(user.email);

    const res = await agent.patch(ME).send({ phone: null });

    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBeNull();
  });

  it("cannot elevate role or change status or email", async () => {
    const user = await createUser();
    const agent = await loginAgent(user.email);

    const res = await agent.patch(ME).send({
      name: "Sneaky",
      role: "admin",
      status: "deactivated",
      email: "other@example.com",
    });

    expect(res.status).toBe(200);
    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored).toMatchObject({
      name: "Sneaky",
      role: "customer",
      status: "active",
      email: user.email,
    });
  });

  it("returns 400 when only forbidden fields are sent", async () => {
    const user = await createUser();
    const agent = await loginAgent(user.email);

    const res = await agent.patch(ME).send({ role: "admin" });

    expect(res.status).toBe(400);
    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored?.role).toBe("customer");
  });

  it.each([
    ["empty name", { name: "" }],
    ["invalid phone", { phone: "abc" }],
  ])("returns 400 for %s", async (_label, body) => {
    const user = await createUser();
    const agent = await loginAgent(user.email);

    const res = await agent.patch(ME).send(body);
    expect(res.status).toBe(400);
  });
});