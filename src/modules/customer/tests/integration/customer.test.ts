import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  api,
  createUser,
  login,
  prisma,
  resetDatabase,
} from "../../../../test/helpers.js";

const BOOKINGS = "/api/v1/customer/bookings";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const createService = () =>
  prisma.service.create({
    data: {
      name: "Phang Nga Bay Cruise",
      type: "TOUR",
      status: "PUBLISHED",
    },
  });

const createBooking = (overrides: Record<string, unknown> = {}) =>
  prisma.booking.create({
    data: {
      basePrice: 1200,
      finalPrice: 1200,
      status: "CONFIRMED",
      ...overrides,
    } as any,
  });

describe("Customer Bookings API Integration Tests", () => {
  it("rejects unauthenticated requests to customer bookings with 401", async () => {
    const res = await api().get(BOOKINGS);
    expect(res.status).toBe(401);
  });

  it("rejects non-customer roles accessing customer bookings with 403", async () => {
    const admin = await createUser({ role: "admin" });
    const client = await login(admin.email);

    const res = await client.get(BOOKINGS);
    expect(res.status).toBe(403);
  });

  it("allows an authenticated customer to list their own bookings", async () => {
    const customer = await createUser({ role: "customer" });
    const service = await createService();
    await createBooking({
      customerId: customer.id,
      serviceId: service.id,
      status: "CONFIRMED",
    });
    await createBooking({
      customerId: customer.id,
      serviceId: service.id,
      status: "CANCELLED",
    });

    const client = await login(customer.email);
    const res = await client.get(BOOKINGS);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.pagination).toMatchObject({
      total: 2,
      totalPages: 1,
      page: 1,
    });
    // No agent-only fields are exposed
    const item = res.body.data.items[0];
    expect(item).toHaveProperty("service");
    expect(item).toHaveProperty("status");
    expect(item).not.toHaveProperty("commission");
    expect(item).not.toHaveProperty("customer");
    expect(item).not.toHaveProperty("agentId");
  });

  it("returns an empty list (not an error) when the customer has no bookings", async () => {
    const customer = await createUser({ role: "customer" });
    const client = await login(customer.email);

    const res = await client.get(BOOKINGS);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(0);
    expect(res.body.data.pagination.total).toBe(0);
  });

  it("enforces cross-customer booking privacy (another customer's booking is 404)", async () => {
    const customerA = await createUser({ role: "customer" });
    const customerB = await createUser({ role: "customer" });
    const service = await createService();

    const bookingA = await createBooking({
      customerId: customerA.id,
      serviceId: service.id,
    });

    // Customer B queries the list -> empty
    const clientB = await login(customerB.email);
    const listResB = await clientB.get(BOOKINGS);
    expect(listResB.status).toBe(200);
    expect(listResB.body.data.items).toHaveLength(0);

    // Customer B fetches Customer A's booking by id -> 404
    const detailResB = await clientB.get(`${BOOKINGS}/${bookingA.id}`);
    expect(detailResB.status).toBe(404);

    // Customer A fetches their own booking -> 200
    const clientA = await login(customerA.email);
    const detailResA = await clientA.get(`${BOOKINGS}/${bookingA.id}`);
    expect(detailResA.status).toBe(200);
    expect(detailResA.body.data.id).toBe(bookingA.id);
    expect(detailResA.body.data).toHaveProperty("service");
    expect(detailResA.body.data).not.toHaveProperty("commission");
  });

  it("supports status filtering", async () => {
    const customer = await createUser({ role: "customer" });
    const service = await createService();
    await createBooking({ customerId: customer.id, serviceId: service.id, status: "CONFIRMED" });
    await createBooking({ customerId: customer.id, serviceId: service.id, status: "CANCELLED" });

    const client = await login(customer.email);
    const res = await client.get(`${BOOKINGS}?status=CONFIRMED`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].status).toBe("CONFIRMED");
  });

  it("supports pagination (limit + page + total)", async () => {
    const customer = await createUser({ role: "customer" });
    const service = await createService();
    for (let i = 0; i < 5; i += 1) {
      await createBooking({ customerId: customer.id, serviceId: service.id });
    }

    const client = await login(customer.email);
    const page1 = await client.get(`${BOOKINGS}?page=1&limit=2`);
    expect(page1.status).toBe(200);
    expect(page1.body.data.items).toHaveLength(2);
    expect(page1.body.data.pagination).toMatchObject({
      page: 1,
      limit: 2,
      total: 5,
      totalPages: 3,
    });

    const page3 = await client.get(`${BOOKINGS}?page=3&limit=2`);
    expect(page3.body.data.items).toHaveLength(1);
    expect(page3.body.data.pagination.page).toBe(3);
  });

  it("rejects an invalid booking id with 400 (param validation)", async () => {
    const customer = await createUser({ role: "customer" });
    const client = await login(customer.email);

    const res = await client.get(`${BOOKINGS}/not-a-uuid`);
    expect(res.status).toBe(400);
  });
});
