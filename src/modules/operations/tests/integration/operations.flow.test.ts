import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { api, prisma, resetDatabase, createUser, loginAgent } from "../../../../test/helpers.js";

const MISSING_ID = "99999999-9999-4999-8999-999999999999";

type Client = Awaited<ReturnType<typeof loginAgent>>;

let adminId: string;
let staffId: string;
let otherStaffId: string;
let inactiveStaffId: string;
let customerId: string;
let serviceId: string;
let adminClient: Client;
let staffClient: Client;
let otherStaffClient: Client;
let customerClient: Client;

type BookingOverrides = Partial<{
  assignedStaffId: string | null;
  status: "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  fulfillmentStatus: "NOT_STARTED" | "IN_PROGRESS" | "FULFILLED";
  paymentStatus: "UNPAID" | "PAID";
}>;

const createBooking = (overrides: BookingOverrides = {}) =>
  prisma.booking.create({
    data: {
      customerId,
      serviceId,
      basePrice: 500,
      finalPrice: 450,
      status: "CONFIRMED",
      fulfillmentStatus: "NOT_STARTED",
      paymentStatus: "UNPAID",
      assignedStaffId: staffId,
      ...overrides,
    },
  });

const reload = (id: string) => prisma.booking.findUniqueOrThrow({ where: { id }, include: { history: true } });

const staffStatus = (client: Client, id: string, body: object) =>
  client.patch(`/api/v1/staff/operations/bookings/${id}/status`).send(body);

const adminStatus = (id: string, body: object) =>
  adminClient.patch(`/api/v1/admin/operations/bookings/${id}/status`).send(body);

const assign = (id: string, body: object) =>
  adminClient.patch(`/api/v1/admin/operations/bookings/${id}/assignment`).send(body);

const idsOf = (res: { body: { data: { items: { id: string }[] } } }) => res.body.data.items.map((i) => i.id).sort();

describe("Operations flow (real database)", () => {
  beforeAll(async () => {
    await resetDatabase();

    const admin = await createUser({ role: "admin" });
    const staff = await createUser({ role: "staff" });
    const otherStaff = await createUser({ role: "staff" });
    const inactiveStaff = await createUser({ role: "staff", status: "deactivated" });
    const customer = await createUser({ role: "customer" });
    const service = await prisma.service.create({ data: { name: "Test Tour", type: "TOUR" } });

    adminId = admin.id;
    staffId = staff.id;
    otherStaffId = otherStaff.id;
    inactiveStaffId = inactiveStaff.id;
    customerId = customer.id;
    serviceId = service.id;

    adminClient = await loginAgent(admin.email);
    staffClient = await loginAgent(staff.email);
    otherStaffClient = await loginAgent(otherStaff.email);
    customerClient = await loginAgent(customer.email);
  });

  beforeEach(async () => {
    await prisma.payment.deleteMany();
    await prisma.bookingHistory.deleteMany();
    await prisma.priceApproval.deleteMany();
    await prisma.booking.deleteMany();
  });

  afterAll(async () => {
    await resetDatabase();
  });

  describe("access control", () => {
    it("returns 401 without a token", async () => {
      const a = await api().get("/api/v1/staff/operations/bookings");
      const b = await api().patch(`/api/v1/admin/operations/bookings/${MISSING_ID}/assignment`).send({ staffId: null });

      expect(a.status).toBe(401);
      expect(b.status).toBe(401);
    });

    it.each([
      ["customer cannot use staff routes", () => customerClient, "get", "/api/v1/staff/operations/bookings"],
      ["admin cannot use staff routes", () => adminClient, "get", "/api/v1/staff/operations/bookings"],
      ["staff cannot use the admin list", () => staffClient, "get", "/api/v1/admin/operations/bookings"],
      ["staff cannot assign", () => staffClient, "patch", `/api/v1/admin/operations/bookings/${MISSING_ID}/assignment`],
      ["staff cannot use admin status", () => staffClient, "patch", `/api/v1/admin/operations/bookings/${MISSING_ID}/status`],
      ["customer cannot use admin status", () => customerClient, "patch", `/api/v1/admin/operations/bookings/${MISSING_ID}/status`],
    ] as const)("returns 403: %s", async (_label, pick, method, path) => {
      const req = (pick() as any)[method](path);
      const res = await (method === "get" ? req : req.send({ fulfillmentStatus: "IN_PROGRESS", notes: "note", staffId: null }));
      expect(res.status).toBe(403);
    });
  });

  describe("staff reads", () => {
    it("lists only operational bookings assigned to the staff member, without prices", async () => {
      const confirmed = await createBooking();
      const inProgress = await createBooking({ status: "IN_PROGRESS", fulfillmentStatus: "IN_PROGRESS" });
      await createBooking({ assignedStaffId: otherStaffId });
      await createBooking({ status: "PENDING" });
      await createBooking({ status: "CANCELLED" });

      const res = await staffClient.get("/api/v1/staff/operations/bookings");

      expect(res.status).toBe(200);
      expect(idsOf(res)).toEqual([confirmed.id, inProgress.id].sort());
      expect(res.body.data.total).toBe(2);
      for (const item of res.body.data.items) {
        expect(item.finalPrice).toBeUndefined();
        expect(item.basePrice).toBeUndefined();
      }
    });

    it("filters by fulfillment status", async () => {
      await createBooking();
      const inProgress = await createBooking({ status: "IN_PROGRESS", fulfillmentStatus: "IN_PROGRESS" });

      const res = await staffClient.get("/api/v1/staff/operations/bookings?fulfillmentStatus=IN_PROGRESS");

      expect(idsOf(res)).toEqual([inProgress.id]);
    });

    it.each(["fulfillmentStatus=DONE", "limit=0", "limit=101", "page=abc"])("returns 400 for ?%s", async (query) => {
      const res = await staffClient.get(`/api/v1/staff/operations/bookings?${query}`);
      expect(res.status).toBe(400);
    });

    it("returns an assigned booking and 404 for others", async () => {
      const own = await createBooking();
      const foreign = await createBooking({ assignedStaffId: otherStaffId });
      const pending = await createBooking({ status: "PENDING" });

      const mine = await staffClient.get(`/api/v1/staff/operations/bookings/${own.id}`);
      const theirs = await staffClient.get(`/api/v1/staff/operations/bookings/${foreign.id}`);
      const notOperational = await staffClient.get(`/api/v1/staff/operations/bookings/${pending.id}`);
      const invalid = await staffClient.get("/api/v1/staff/operations/bookings/not-a-uuid");

      expect(mine.status).toBe(200);
      expect(mine.body.data.id).toBe(own.id);
      expect(mine.body.data.finalPrice).toBeUndefined();
      expect(theirs.status).toBe(404);
      expect(notOperational.status).toBe(404);
      expect(invalid.status).toBe(400);
    });
  });

  describe("PATCH /staff/operations/bookings/:bookingId/status", () => {
    it("starts fulfillment without changing price or payment status", async () => {
      const booking = await createBooking();

      const res = await staffStatus(staffClient, booking.id, { fulfillmentStatus: "IN_PROGRESS", notes: "Started" });

      expect(res.status).toBe(200);
      const saved = await reload(booking.id);
      expect(saved.fulfillmentStatus).toBe("IN_PROGRESS");
      expect(saved.status).toBe("IN_PROGRESS");
      expect(saved.paymentStatus).toBe("UNPAID");
      expect(Number(saved.finalPrice)).toBe(450);
      expect(saved.history).toHaveLength(1);
      expect(saved.history[0]).toMatchObject({
        action: "OPERATIONS_STATUS_UPDATED",
        actorId: staffId,
        actorRole: "staff",
      });
    });

    it("returns 409 when completing an unpaid booking and changes nothing", async () => {
      const booking = await createBooking({ status: "IN_PROGRESS", fulfillmentStatus: "IN_PROGRESS" });

      const res = await staffStatus(staffClient, booking.id, { fulfillmentStatus: "FULFILLED" });

      expect(res.status).toBe(409);
      const saved = await reload(booking.id);
      expect(saved.status).toBe("IN_PROGRESS");
      expect(saved.fulfillmentStatus).toBe("IN_PROGRESS");
      expect(saved.history).toHaveLength(0);
    });

    it("completes a paid booking", async () => {
      const booking = await createBooking({
        status: "IN_PROGRESS",
        fulfillmentStatus: "IN_PROGRESS",
        paymentStatus: "PAID",
      });

      const res = await staffStatus(staffClient, booking.id, { fulfillmentStatus: "FULFILLED" });

      expect(res.status).toBe(200);
      const saved = await reload(booking.id);
      expect(saved.status).toBe("COMPLETED");
      expect(saved.fulfillmentStatus).toBe("FULFILLED");
      expect(saved.paymentStatus).toBe("PAID");
    });

    it("returns 404 for a booking assigned to someone else", async () => {
      const booking = await createBooking({ assignedStaffId: otherStaffId });

      const res = await staffStatus(staffClient, booking.id, { fulfillmentStatus: "IN_PROGRESS" });

      expect(res.status).toBe(404);
      expect((await reload(booking.id)).fulfillmentStatus).toBe("NOT_STARTED");
    });

    it("returns 403 when staff try a backward correction", async () => {
      const booking = await createBooking({ status: "IN_PROGRESS", fulfillmentStatus: "IN_PROGRESS" });

      const res = await staffStatus(staffClient, booking.id, { fulfillmentStatus: "NOT_STARTED" });

      expect(res.status).toBe(403);
      expect((await reload(booking.id)).fulfillmentStatus).toBe("IN_PROGRESS");
    });

    it("returns 409 for a skipped step and for an unchanged status", async () => {
      const booking = await createBooking();

      const skipped = await staffStatus(staffClient, booking.id, { fulfillmentStatus: "FULFILLED" });
      const unchanged = await staffStatus(staffClient, booking.id, { fulfillmentStatus: "NOT_STARTED" });

      expect(skipped.status).toBe(409);
      expect(unchanged.status).toBe(409);
    });

    it("returns 409 when the booking is not confirmed yet", async () => {
      const booking = await createBooking({ status: "PENDING" });

      const res = await staffStatus(staffClient, booking.id, { fulfillmentStatus: "IN_PROGRESS" });

      expect(res.status).toBe(409);
      expect((await reload(booking.id)).status).toBe("PENDING");
    });

    it("returns 400 for an invalid status", async () => {
      const booking = await createBooking();
      const res = await staffStatus(staffClient, booking.id, { fulfillmentStatus: "DONE" });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /admin/operations/bookings", () => {
    it("lists all operational bookings and filters by assigned staff", async () => {
      const mine = await createBooking();
      const theirs = await createBooking({ assignedStaffId: otherStaffId });
      const unassigned = await createBooking({ assignedStaffId: null, status: "IN_PROGRESS" });
      await createBooking({ status: "PENDING" });

      const all = await adminClient.get("/api/v1/admin/operations/bookings");
      const filtered = await adminClient.get(`/api/v1/admin/operations/bookings?assignedStaffId=${otherStaffId}`);
      const invalid = await adminClient.get("/api/v1/admin/operations/bookings?assignedStaffId=not-a-uuid");

      expect(idsOf(all)).toEqual([mine.id, theirs.id, unassigned.id].sort());
      expect(idsOf(filtered)).toEqual([theirs.id]);
      expect(invalid.status).toBe(400);
    });
  });

  describe("PATCH /admin/operations/bookings/:bookingId/assignment", () => {
    it("assigns a staff member and records it", async () => {
      const booking = await createBooking({ assignedStaffId: null });

      const res = await assign(booking.id, { staffId: otherStaffId, notes: "Handover" });

      expect(res.status).toBe(200);
      expect(res.body.data.assignedStaff.id).toBe(otherStaffId);
      const saved = await reload(booking.id);
      expect(saved.assignedStaffId).toBe(otherStaffId);
      expect(saved.history[0]).toMatchObject({ action: "OPERATIONS_ASSIGNED", actorId: adminId, actorRole: "admin" });
    });

    it("unassigns with null", async () => {
      const booking = await createBooking();

      const res = await assign(booking.id, { staffId: null });

      expect(res.status).toBe(200);
      const saved = await reload(booking.id);
      expect(saved.assignedStaffId).toBeNull();
      expect(saved.history[0]).toMatchObject({ action: "OPERATIONS_UNASSIGNED" });
    });

    it("reassigning removes the booking from the previous staff member's queue", async () => {
      const booking = await createBooking();

      await assign(booking.id, { staffId: otherStaffId });
      const oldQueue = await staffClient.get("/api/v1/staff/operations/bookings");
      const newQueue = await otherStaffClient.get("/api/v1/staff/operations/bookings");

      expect(idsOf(oldQueue)).toEqual([]);
      expect(idsOf(newQueue)).toEqual([booking.id]);
    });

    it("returns 400 for a user who is not an active staff member", async () => {
      const booking = await createBooking({ assignedStaffId: null });

      const customer = await assign(booking.id, { staffId: customerId });
      const inactive = await assign(booking.id, { staffId: inactiveStaffId });
      const unknown = await assign(booking.id, { staffId: MISSING_ID });

      expect(customer.status).toBe(400);
      expect(inactive.status).toBe(400);
      expect(unknown.status).toBe(400);
      expect((await reload(booking.id)).assignedStaffId).toBeNull();
    });

    it("returns 400 when staffId is missing", async () => {
      const booking = await createBooking();
      const res = await assign(booking.id, {});
      expect(res.status).toBe(400);
    });

    it("returns 404 for an unknown booking", async () => {
      const res = await assign(MISSING_ID, { staffId });
      expect(res.status).toBe(404);
    });

    it("returns 409 for a completed booking", async () => {
      const booking = await createBooking({ status: "COMPLETED", fulfillmentStatus: "FULFILLED", paymentStatus: "PAID" });

      const res = await assign(booking.id, { staffId: otherStaffId });

      expect(res.status).toBe(409);
      expect((await reload(booking.id)).assignedStaffId).toBe(staffId);
    });
  });

  describe("PATCH /admin/operations/bookings/:bookingId/status", () => {
    it.each([
      ["missing notes", { fulfillmentStatus: "IN_PROGRESS" }],
      ["too short notes", { fulfillmentStatus: "IN_PROGRESS", notes: "ab" }],
    ])("returns 400 for %s", async (_label, body) => {
      const booking = await createBooking({ status: "COMPLETED", fulfillmentStatus: "FULFILLED", paymentStatus: "PAID" });
      const res = await adminStatus(booking.id, body);
      expect(res.status).toBe(400);
      expect((await reload(booking.id)).status).toBe("COMPLETED");
    });

    it("corrects a completed booking back to in progress without touching price or payment", async () => {
      const booking = await createBooking({
        status: "COMPLETED",
        fulfillmentStatus: "FULFILLED",
        paymentStatus: "PAID",
        assignedStaffId: null,
      });

      const res = await adminStatus(booking.id, { fulfillmentStatus: "IN_PROGRESS", notes: "Marked complete by mistake" });

      expect(res.status).toBe(200);
      const saved = await reload(booking.id);
      expect(saved.status).toBe("IN_PROGRESS");
      expect(saved.fulfillmentStatus).toBe("IN_PROGRESS");
      expect(saved.paymentStatus).toBe("PAID");
      expect(Number(saved.finalPrice)).toBe(450);
      expect(saved.history[0]).toMatchObject({
        action: "OPERATIONS_STATUS_CORRECTED",
        actorId: adminId,
        actorRole: "admin",
      });
    });

    it("moves an in-progress booking back to not started", async () => {
      const booking = await createBooking({ status: "IN_PROGRESS", fulfillmentStatus: "IN_PROGRESS" });

      const res = await adminStatus(booking.id, { fulfillmentStatus: "NOT_STARTED", notes: "Started too early" });

      expect(res.status).toBe(200);
      const saved = await reload(booking.id);
      expect(saved.status).toBe("CONFIRMED");
      expect(saved.fulfillmentStatus).toBe("NOT_STARTED");
    });

    it("can start a booking that has no assigned staff", async () => {
      const booking = await createBooking({ assignedStaffId: null });

      const res = await adminStatus(booking.id, { fulfillmentStatus: "IN_PROGRESS", notes: "Started by admin" });

      expect(res.status).toBe(200);
      expect((await reload(booking.id)).status).toBe("IN_PROGRESS");
    });

    it("still requires verified payment to complete", async () => {
      const booking = await createBooking({ status: "IN_PROGRESS", fulfillmentStatus: "IN_PROGRESS" });

      const res = await adminStatus(booking.id, { fulfillmentStatus: "FULFILLED", notes: "Trying to complete" });

      expect(res.status).toBe(409);
      expect((await reload(booking.id)).status).toBe("IN_PROGRESS");
    });

    it("returns 404 for an unknown booking", async () => {
      const res = await adminStatus(MISSING_ID, { fulfillmentStatus: "IN_PROGRESS", notes: "Correction" });
      expect(res.status).toBe(404);
    });
  });

  describe("full flow", () => {
    it("assign, start, blocked completion, payment, completion, admin correction", async () => {
      const booking = await createBooking({ assignedStaffId: null });

      expect((await assign(booking.id, { staffId })).status).toBe(200);
      expect((await staffStatus(staffClient, booking.id, { fulfillmentStatus: "IN_PROGRESS" })).status).toBe(200);
      expect((await staffStatus(staffClient, booking.id, { fulfillmentStatus: "FULFILLED" })).status).toBe(409);

      await prisma.booking.update({ where: { id: booking.id }, data: { paymentStatus: "PAID" } });

      expect((await staffStatus(staffClient, booking.id, { fulfillmentStatus: "FULFILLED" })).status).toBe(200);
      expect(
        (await adminStatus(booking.id, { fulfillmentStatus: "IN_PROGRESS", notes: "Customer reported an issue" })).status,
      ).toBe(200);

      const saved = await reload(booking.id);
      expect(saved.status).toBe("IN_PROGRESS");
      expect(saved.paymentStatus).toBe("PAID");
      expect(Number(saved.finalPrice)).toBe(450);
      expect(saved.history.map((h) => h.action).sort()).toEqual([
        "OPERATIONS_ASSIGNED",
        "OPERATIONS_STATUS_CORRECTED",
        "OPERATIONS_STATUS_UPDATED",
        "OPERATIONS_STATUS_UPDATED",
      ]);
    });
  });
});