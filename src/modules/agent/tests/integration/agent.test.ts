import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  api,
  createUser,
  loginAgent,
  prisma,
  resetDatabase,
} from "../../../../test/helpers.js";

const OVERVIEW = "/api/v1/agent/overview";
const BOOKINGS = "/api/v1/agent/bookings";
const PROFILE = "/api/v1/agent/profile";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe("Agent Portal API Integration Tests", () => {
  it("rejects unauthenticated requests to agent endpoints with 401", async () => {
    const res = await api().get(OVERVIEW);
    expect(res.status).toBe(401);
  });

  it("rejects customer accounts accessing agent endpoints with 403", async () => {
    const customer = await createUser({ role: "customer" });
    const client = await loginAgent(customer.email);

    const res = await client.get(OVERVIEW);
    expect(res.status).toBe(403);
  });

  it("allows authenticated agent to retrieve real dashboard overview metrics", async () => {
    const agentUser = await createUser({ role: "agent" });
    const client = await loginAgent(agentUser.email);

    const res = await client.get(OVERVIEW);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      totalBookings: 0,
      pendingBookings: 0,
      confirmedBookings: 0,
      completedBookings: 0,
      cancelledBookings: 0,
      totalCommission: 0,
      paidCommission: 0,
      pendingCommission: 0,
      activeCommissionsCount: 0,
    });
  });

  it("returns agency profile and allows agencyName updates", async () => {
    const agentUser = await createUser({
      name: "Sam Agent",
      phone: "+66 81 222 3333",
      role: "agent",
    });
    await prisma.agentProfile.create({
      data: {
        userId: agentUser.id,
        agencyName: "Andaman Tours Co.",
      },
    });

    const client = await loginAgent(agentUser.email);

    // 1. GET profile
    const getRes = await client.get(PROFILE);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data).toMatchObject({
      id: agentUser.id,
      name: "Sam Agent",
      email: agentUser.email,
      agencyName: "Andaman Tours Co.",
      role: "agent",
    });

    // 2. PATCH profile
    const patchRes = await client.patch(PROFILE).send({
      agencyName: "Andaman Premier Travel Ltd.",
      phone: "+66 81 999 8888",
    });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.agencyName).toBe("Andaman Premier Travel Ltd.");
    expect(patchRes.body.data.phone).toBe("+66 81 999 8888");

    // Verify DB persistence
    const profileInDb = await prisma.agentProfile.findUnique({
      where: { userId: agentUser.id },
    });
    expect(profileInDb?.agencyName).toBe("Andaman Premier Travel Ltd.");
  });

  it("enforces cross-agent booking privacy and isolation", async () => {
    // 1. Create two agents
    const agentA = await createUser({ role: "agent" });
    const agentB = await createUser({ role: "agent" });
    const customer = await createUser({ role: "customer" });

    // Create a service
    const service = await prisma.service.create({
      data: {
        name: "Phi Phi Island Day Trip",
        type: "TOUR",
        status: "PUBLISHED",
      },
    });

    // 2. Create a booking for Agent A
    const bookingA = await prisma.booking.create({
      data: {
        agentId: agentA.id,
        customerId: customer.id,
        serviceId: service.id,
        currency: "THB",
        basePrice: 1500,
        finalPrice: 1500,
        status: "CONFIRMED",
      },
    });

    // 3. Agent A queries their bookings
    const clientA = await loginAgent(agentA.email);
    const listResA = await clientA.get(BOOKINGS);
    expect(listResA.status).toBe(200);
    expect(listResA.body.data.items).toHaveLength(1);
    expect(listResA.body.data.items[0].id).toBe(bookingA.id);

    // 4. Agent B queries their bookings -> must be empty
    const clientB = await loginAgent(agentB.email);
    const listResB = await clientB.get(BOOKINGS);
    expect(listResB.status).toBe(200);
    expect(listResB.body.data.items).toHaveLength(0);

    // 5. Agent B attempts to access Agent A's booking by ID -> must return 404
    const detailResB = await clientB.get(`${BOOKINGS}/${bookingA.id}`);
    expect(detailResB.status).toBe(404);

    // 6. Agent A accesses their own booking -> returns 200
    const detailResA = await clientA.get(`${BOOKINGS}/${bookingA.id}`);
    expect(detailResA.status).toBe(200);
    expect(detailResA.body.data.id).toBe(bookingA.id);
  });
});
