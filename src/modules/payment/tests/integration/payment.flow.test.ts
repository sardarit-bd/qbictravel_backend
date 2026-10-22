import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { api, prisma, resetDatabase, createUser, loginAgent } from "../../../../test/helpers.js";

const MISSING_ID = "99999999-9999-4999-8999-999999999999";

type Client = Awaited<ReturnType<typeof loginAgent>>;

let adminId: string;
let agentId: string;
let customerId: string;
let otherCustomerId: string;
let serviceId: string;
let adminClient: Client;
let agentClient: Client;
let staffClient: Client;
let customerClient: Client;
let otherCustomerClient: Client;

type BookingOverrides = Partial<{
  customerId: string;
  agentId: string | null;
  status: "PENDING" | "CONFIRMED" | "AWAITING_APPROVAL" | "CANCELLED";
  paymentStatus: "UNPAID" | "PAID";
  requiresApproval: boolean;
  finalPrice: number;
}>;

const createBooking = (overrides: BookingOverrides = {}) =>
  prisma.booking.create({
    data: {
      customerId,
      agentId: null,
      serviceId,
      basePrice: 500,
      finalPrice: 450,
      status: "CONFIRMED",
      ...overrides,
    },
  });

type PaymentOverrides = Partial<{
  customerId: string;
  amount: number;
  method: "BANK_TRANSFER" | "CASH" | "OTHER";
  status: "INITIATED" | "SUBMITTED" | "VERIFIED" | "REJECTED";
  reference: string | null;
}>;

const createPaymentRow = (bookingId: string, overrides: PaymentOverrides = {}) =>
  prisma.payment.create({
    data: {
      bookingId,
      customerId,
      amount: 450,
      method: "BANK_TRANSFER",
      status: "SUBMITTED",
      reference: null,
      ...overrides,
    },
  });

const reloadBooking = (id: string) =>
  prisma.booking.findUniqueOrThrow({ where: { id }, include: { history: true } });

const reloadPayment = (id: string) => prisma.payment.findUniqueOrThrow({ where: { id } });

const pay = (client: Client, bookingId: string, body: object) =>
  client.post(`/api/v1/bookings/${bookingId}/payments`).send(body);

const verify = (paymentId: string, body: object) =>
  adminClient.post(`/api/v1/admin/payments/${paymentId}/verify`).send(body);

const record = (paymentId: string, body: object = {}) =>
  adminClient.post(`/api/v1/admin/payments/${paymentId}/record`).send(body);

const idsOf = (res: { body: { data: { items: { id: string }[] } } }) => res.body.data.items.map((i) => i.id).sort();

describe("Payment flow (real database)", () => {
  beforeAll(async () => {
    await resetDatabase();

    const admin = await createUser({ role: "admin" });
    const agent = await createUser({ role: "agent" });
    const staff = await createUser({ role: "staff" });
    const customer = await createUser({ role: "customer" });
    const otherCustomer = await createUser({ role: "customer" });
    const service = await prisma.service.create({ data: { name: "Test Tour", type: "TOUR" } });

    adminId = admin.id;
    agentId = agent.id;
    customerId = customer.id;
    otherCustomerId = otherCustomer.id;
    serviceId = service.id;

    adminClient = await loginAgent(admin.email);
    agentClient = await loginAgent(agent.email);
    staffClient = await loginAgent(staff.email);
    customerClient = await loginAgent(customer.email);
    otherCustomerClient = await loginAgent(otherCustomer.email);
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
      const a = await api().post(`/api/v1/bookings/${MISSING_ID}/payments`).send({ method: "CASH" });
      const b = await api().get("/api/v1/customer/payments");
      const c = await api().post(`/api/v1/admin/payments/${MISSING_ID}/verify`).send({ decision: "VERIFIED" });

      expect(a.status).toBe(401);
      expect(b.status).toBe(401);
      expect(c.status).toBe(401);
    });

    it.each([
      ["agent cannot create a payment", () => agentClient, "post", `/api/v1/bookings/${MISSING_ID}/payments`],
      ["admin cannot create a payment", () => adminClient, "post", `/api/v1/bookings/${MISSING_ID}/payments`],
      ["agent cannot use the customer list", () => agentClient, "get", "/api/v1/customer/payments"],
      ["customer cannot use the agent list", () => customerClient, "get", "/api/v1/agent/payments"],
      ["customer cannot use the admin list", () => customerClient, "get", "/api/v1/admin/payments"],
      ["agent cannot use the admin list", () => agentClient, "get", "/api/v1/admin/payments"],
      ["staff cannot verify", () => staffClient, "post", `/api/v1/admin/payments/${MISSING_ID}/verify`],
      ["customer cannot verify", () => customerClient, "post", `/api/v1/admin/payments/${MISSING_ID}/verify`],
      ["staff cannot record", () => staffClient, "post", `/api/v1/admin/payments/${MISSING_ID}/record`],
    ] as const)("returns 403: %s", async (_label, pick, method, path) => {
      const req = (pick() as any)[method](path);
      const res = await (method === "get" ? req : req.send({ method: "CASH", decision: "VERIFIED" }));
      expect(res.status).toBe(403);
    });
  });

  describe("POST /bookings/:bookingId/payments", () => {
    it("creates an INITIATED payment at the booking price and ignores a client amount", async () => {
      const booking = await createBooking();

      const res = await pay(customerClient, booking.id, { method: "CASH", amount: 1 });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("INITIATED");
      expect(res.body.data.amount).toBe(450);

      const saved = await reloadPayment(res.body.data.id);
      expect(Number(saved.amount)).toBe(450);
      expect(saved.customerId).toBe(customerId);

      const bookingAfter = await reloadBooking(booking.id);
      expect(bookingAfter.paymentStatus).toBe("UNPAID");
      expect(bookingAfter.history.map((h) => h.action)).toContain("PAYMENT_INITIATED");
    });

    it("creates a SUBMITTED payment with a reference and does not mark the booking paid", async () => {
      const booking = await createBooking();

      const res = await pay(customerClient, booking.id, {
        method: "BANK_TRANSFER",
        reference: "TRX-1001",
        receiptNote: "Paid from my account",
      });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("SUBMITTED");

      const saved = await reloadPayment(res.body.data.id);
      expect(saved.reference).toBe("TRX-1001");
      expect(saved.submittedAt).not.toBeNull();

      const bookingAfter = await reloadBooking(booking.id);
      expect(bookingAfter.paymentStatus).toBe("UNPAID");
      expect(bookingAfter.status).toBe("CONFIRMED");
      expect(bookingAfter.history.map((h) => h.action)).toContain("PAYMENT_SUBMITTED");
    });

    it.each(["PENDING", "CONFIRMED"] as const)("accepts a payment for a %s booking", async (status) => {
      const booking = await createBooking({ status });
      const res = await pay(customerClient, booking.id, { method: "CASH" });
      expect(res.status).toBe(201);
    });

    it("returns 404 for another customer's booking", async () => {
      const booking = await createBooking({ customerId: otherCustomerId });

      const res = await pay(customerClient, booking.id, { method: "CASH" });

      expect(res.status).toBe(404);
      expect(await prisma.payment.count()).toBe(0);
    });

    it("returns 404 for an unknown booking", async () => {
      const res = await pay(customerClient, MISSING_ID, { method: "CASH" });
      expect(res.status).toBe(404);
    });

    it("returns 409 for bookings that cannot accept a payment", async () => {
      const awaiting = await createBooking({ status: "AWAITING_APPROVAL" });
      const cancelled = await createBooking({ status: "CANCELLED" });
      const needsApproval = await createBooking({ requiresApproval: true });
      const paid = await createBooking({ paymentStatus: "PAID" });

      for (const booking of [awaiting, cancelled, needsApproval, paid]) {
        const res = await pay(customerClient, booking.id, { method: "CASH" });
        expect(res.status).toBe(409);
      }
      expect(await prisma.payment.count()).toBe(0);
    });

    it("returns 409 when the booking already has an active payment", async () => {
      const booking = await createBooking();

      const first = await pay(customerClient, booking.id, { method: "CASH" });
      const second = await pay(customerClient, booking.id, { method: "BANK_TRANSFER", reference: "TRX-2002" });

      expect(first.status).toBe(201);
      expect(second.status).toBe(409);
      expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(1);
    });

    it("allows a new payment after the previous one was rejected", async () => {
      const booking = await createBooking();
      await createPaymentRow(booking.id, { status: "REJECTED", reference: "TRX-OLD" });

      const res = await pay(customerClient, booking.id, { method: "BANK_TRANSFER", reference: "TRX-NEW" });

      expect(res.status).toBe(201);
      expect(await prisma.payment.count({ where: { bookingId: booking.id } })).toBe(2);
    });

    it("returns 409 when the same method and reference is used on another booking", async () => {
      const first = await createBooking();
      const second = await createBooking();

      const a = await pay(customerClient, first.id, { method: "BANK_TRANSFER", reference: "TRX-DUP" });
      const b = await pay(customerClient, second.id, { method: "BANK_TRANSFER", reference: "TRX-DUP" });

      expect(a.status).toBe(201);
      expect(b.status).toBe(409);
      expect(await prisma.payment.count({ where: { bookingId: second.id } })).toBe(0);
    });

    it("returns 400 for an invalid method", async () => {
      const booking = await createBooking();
      const res = await pay(customerClient, booking.id, { method: "BITCOIN" });
      expect(res.status).toBe(400);
    });
  });

  describe("customer reads", () => {
    it("lists only the customer's own payments", async () => {
      const own = await createBooking();
      const foreign = await createBooking({ customerId: otherCustomerId });
      const ownPayment = await createPaymentRow(own.id);
      await createPaymentRow(foreign.id, { customerId: otherCustomerId });

      const res = await customerClient.get("/api/v1/customer/payments");

      expect(res.status).toBe(200);
      expect(idsOf(res)).toEqual([ownPayment.id]);
      expect(res.body.data).toMatchObject({ page: 1, limit: 20, total: 1 });
    });

    it("filters by status", async () => {
      const a = await createBooking();
      const b = await createBooking();
      await createPaymentRow(a.id, { status: "SUBMITTED" });
      const rejected = await createPaymentRow(b.id, { status: "REJECTED" });

      const res = await customerClient.get("/api/v1/customer/payments?status=REJECTED");

      expect(res.status).toBe(200);
      expect(idsOf(res)).toEqual([rejected.id]);
    });

    it.each(["limit=0", "limit=101", "page=abc", "status=BOGUS"])("returns 400 for ?%s", async (query) => {
      const res = await customerClient.get(`/api/v1/customer/payments?${query}`);
      expect(res.status).toBe(400);
    });

    it("returns the customer's own payment and 404 for someone else's", async () => {
      const own = await createBooking();
      const foreign = await createBooking({ customerId: otherCustomerId });
      const ownPayment = await createPaymentRow(own.id);
      const foreignPayment = await createPaymentRow(foreign.id, { customerId: otherCustomerId });

      const mine = await customerClient.get(`/api/v1/customer/payments/${ownPayment.id}`);
      const theirs = await customerClient.get(`/api/v1/customer/payments/${foreignPayment.id}`);
      const invalid = await customerClient.get("/api/v1/customer/payments/not-a-uuid");

      expect(mine.status).toBe(200);
      expect(mine.body.data.id).toBe(ownPayment.id);
      expect(theirs.status).toBe(404);
      expect(invalid.status).toBe(400);
    });
  });

  describe("agent reads", () => {
    it("lists only payments on the agent's own bookings", async () => {
      const agentBooking = await createBooking({ agentId });
      const directBooking = await createBooking();
      const agentPayment = await createPaymentRow(agentBooking.id);
      await createPaymentRow(directBooking.id);

      const res = await agentClient.get("/api/v1/agent/payments");

      expect(res.status).toBe(200);
      expect(idsOf(res)).toEqual([agentPayment.id]);
    });
  });

  describe("admin reads", () => {
    it("lists all payments and supports filters", async () => {
      const a = await createBooking();
      const b = await createBooking({ customerId: otherCustomerId });
      const first = await createPaymentRow(a.id, { status: "SUBMITTED" });
      const second = await createPaymentRow(b.id, { customerId: otherCustomerId, status: "VERIFIED", method: "CASH" });

      const all = await adminClient.get("/api/v1/admin/payments");
      const byStatus = await adminClient.get("/api/v1/admin/payments?status=VERIFIED");
      const byBooking = await adminClient.get(`/api/v1/admin/payments?bookingId=${a.id}`);
      const byCustomer = await adminClient.get(`/api/v1/admin/payments?customerId=${otherCustomerId}`);
      const invalid = await adminClient.get("/api/v1/admin/payments?bookingId=not-a-uuid");

      expect(idsOf(all)).toEqual([first.id, second.id].sort());
      expect(idsOf(byStatus)).toEqual([second.id]);
      expect(idsOf(byBooking)).toEqual([first.id]);
      expect(idsOf(byCustomer)).toEqual([second.id]);
      expect(invalid.status).toBe(400);
    });

    it("returns payment details and 404 for an unknown payment", async () => {
      const booking = await createBooking();
      const payment = await createPaymentRow(booking.id);

      const found = await adminClient.get(`/api/v1/admin/payments/${payment.id}`);
      const missing = await adminClient.get(`/api/v1/admin/payments/${MISSING_ID}`);

      expect(found.status).toBe(200);
      expect(found.body.data.booking.finalPrice).toBe(450);
      expect(missing.status).toBe(404);
    });
  });

  describe("POST /admin/payments/:paymentId/verify", () => {
    it("verifies a submitted payment and marks only the payment status as paid", async () => {
      const booking = await createBooking();
      const payment = await createPaymentRow(booking.id, { reference: "TRX-1" });

      const res = await verify(payment.id, { decision: "VERIFIED", notes: "Checked with the bank" });

      expect(res.status).toBe(200);
      const savedPayment = await reloadPayment(payment.id);
      expect(savedPayment).toMatchObject({ status: "VERIFIED", reviewedById: adminId, reviewNotes: "Checked with the bank" });
      expect(savedPayment.reviewedAt).not.toBeNull();

      const savedBooking = await reloadBooking(booking.id);
      expect(savedBooking.paymentStatus).toBe("PAID");
      expect(savedBooking.status).toBe("CONFIRMED");
      expect(savedBooking.fulfillmentStatus).toBe("NOT_STARTED");
      expect(Number(savedBooking.finalPrice)).toBe(450);
      expect(savedBooking.history.some((h) => h.action === "PAYMENT_VERIFIED" && h.actorId === adminId)).toBe(true);
    });

    it("returns 409 for a payment that is not submitted", async () => {
      const booking = await createBooking();
      const initiated = await createPaymentRow(booking.id, { status: "INITIATED" });

      const res = await verify(initiated.id, { decision: "VERIFIED" });

      expect(res.status).toBe(409);
      expect((await reloadBooking(booking.id)).paymentStatus).toBe("UNPAID");
    });

    it("requires notes to reject, then rejects without marking the booking paid", async () => {
      const booking = await createBooking();
      const payment = await createPaymentRow(booking.id, { reference: "TRX-2" });

      const withoutNotes = await verify(payment.id, { decision: "REJECTED" });
      const rejected = await verify(payment.id, { decision: "REJECTED", notes: "Reference not found" });

      expect(withoutNotes.status).toBe(400);
      expect(rejected.status).toBe(200);
      expect((await reloadPayment(payment.id)).status).toBe("REJECTED");
      expect((await reloadBooking(booking.id)).paymentStatus).toBe("UNPAID");
    });

    it("returns 409 when the same payment is reviewed twice", async () => {
      const booking = await createBooking();
      const payment = await createPaymentRow(booking.id, { reference: "TRX-3" });

      const first = await verify(payment.id, { decision: "VERIFIED" });
      const second = await verify(payment.id, { decision: "VERIFIED" });

      expect(first.status).toBe(200);
      expect(second.status).toBe(409);
      expect(
        (await reloadBooking(booking.id)).history.filter((h) => h.action === "PAYMENT_VERIFIED"),
      ).toHaveLength(1);
    });

    it("returns 409 when the amount no longer matches the booking price", async () => {
      const booking = await createBooking({ finalPrice: 450 });
      const payment = await createPaymentRow(booking.id, { amount: 400, reference: "TRX-4" });

      const res = await verify(payment.id, { decision: "VERIFIED" });

      expect(res.status).toBe(409);
      expect((await reloadPayment(payment.id)).status).toBe("SUBMITTED");
      expect((await reloadBooking(booking.id)).paymentStatus).toBe("UNPAID");
    });

    it("returns 404 for an unknown payment", async () => {
      const res = await verify(MISSING_ID, { decision: "VERIFIED" });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /admin/payments/:paymentId/record", () => {
    it("records an initiated payment as verified and marks the booking paid", async () => {
      const booking = await createBooking();
      const payment = await createPaymentRow(booking.id, { method: "CASH", status: "INITIATED" });
      const receivedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const res = await record(payment.id, { reference: "RCPT-9", receivedAt, notes: "Cash at office" });

      expect(res.status).toBe(200);
      const savedPayment = await reloadPayment(payment.id);
      expect(savedPayment).toMatchObject({ status: "VERIFIED", reference: "RCPT-9", reviewedById: adminId });
      expect(savedPayment.receivedAt).not.toBeNull();

      const savedBooking = await reloadBooking(booking.id);
      expect(savedBooking.paymentStatus).toBe("PAID");
      expect(savedBooking.fulfillmentStatus).toBe("NOT_STARTED");
      expect(savedBooking.history.some((h) => h.action === "PAYMENT_RECORDED")).toBe(true);
    });

    it("returns 409 for a submitted receipt", async () => {
      const booking = await createBooking();
      const payment = await createPaymentRow(booking.id, { status: "SUBMITTED", reference: "TRX-5" });

      const res = await record(payment.id);

      expect(res.status).toBe(409);
      expect((await reloadBooking(booking.id)).paymentStatus).toBe("UNPAID");
    });

    it("returns 400 for a future received date", async () => {
      const booking = await createBooking();
      const payment = await createPaymentRow(booking.id, { method: "CASH", status: "INITIATED" });
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const res = await record(payment.id, { receivedAt: future });

      expect(res.status).toBe(400);
      expect((await reloadPayment(payment.id)).status).toBe("INITIATED");
    });

    it("returns 409 when the reference is already used by another payment", async () => {
      const first = await createBooking();
      const second = await createBooking();
      await createPaymentRow(first.id, { method: "CASH", status: "VERIFIED", reference: "RCPT-DUP" });
      const initiated = await createPaymentRow(second.id, { method: "CASH", status: "INITIATED" });

      const res = await record(initiated.id, { reference: "RCPT-DUP" });

      expect(res.status).toBe(409);
      expect((await reloadPayment(initiated.id)).status).toBe("INITIATED");
      expect((await reloadBooking(second.id)).paymentStatus).toBe("UNPAID");
    });
  });

  describe("full flow", () => {
    it("customer submits a receipt, admin verifies it, and no further payment is accepted", async () => {
      const booking = await createBooking();

      const submitted = await pay(customerClient, booking.id, { method: "BANK_TRANSFER", reference: "TRX-FLOW" });
      expect(submitted.status).toBe(201);
      expect((await reloadBooking(booking.id)).paymentStatus).toBe("UNPAID");

      const verified = await verify(submitted.body.data.id, { decision: "VERIFIED" });
      expect(verified.status).toBe(200);

      const saved = await reloadBooking(booking.id);
      expect(saved.paymentStatus).toBe("PAID");
      expect(saved.fulfillmentStatus).toBe("NOT_STARTED");
      expect(saved.history.map((h) => h.action).sort()).toEqual(["PAYMENT_SUBMITTED", "PAYMENT_VERIFIED"]);

      const again = await pay(customerClient, booking.id, { method: "CASH" });
      expect(again.status).toBe(409);

      const other = await pay(otherCustomerClient, booking.id, { method: "CASH" });
      expect(other.status).toBe(404);
    });
  });
});