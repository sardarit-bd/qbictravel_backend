import { describe, it, expect, vi, beforeEach } from "vitest";
import AppError from "../../../../shared/utils/AppError.js";
import * as paymentRepository from "../../paymentRepository.js";
import * as paymentService from "../../paymentService.js";
vi.mock("../../../notification/notificationService.js");
vi.mock("../../paymentRepository.js");

const repo = vi.mocked(paymentRepository);

const CUSTOMER_ID = "customer-1";
const ADMIN_ID = "admin-1";
const BOOKING_ID = "booking-1";
const PAYMENT_ID = "payment-1";

const makeBooking = (overrides: Record<string, unknown> = {}) =>
  ({
    id: BOOKING_ID,
    customerId: CUSTOMER_ID,
    status: "CONFIRMED",
    requiresApproval: false,
    paymentStatus: "UNPAID",
    finalPrice: "450.00",
    ...overrides,
  }) as any;

const makePayment = (overrides: Record<string, unknown> = {}) =>
  ({
    id: PAYMENT_ID,
    bookingId: BOOKING_ID,
    customerId: CUSTOMER_ID,
    amount: "450.00",
    method: "BANK_TRANSFER",
    status: "SUBMITTED",
    reference: "TRX-1001",
    booking: { id: BOOKING_ID, finalPrice: "450.00", paymentStatus: "UNPAID" },
    ...overrides,
  }) as any;

const expectAppError = async (promise: Promise<unknown>, statusCode: number) => {
  await expect(promise).rejects.toBeInstanceOf(AppError);
  await expect(promise).rejects.toMatchObject({ statusCode });
};

describe("paymentService.createPayment", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    repo.findBookingForPayment.mockResolvedValue(makeBooking());
    repo.createPaymentIfNoneActive.mockImplementation(async (p: any) => makePayment({ status: p.status, amount: p.amount }));
  });

  it("returns 404 for a missing booking", async () => {
    repo.findBookingForPayment.mockResolvedValue(null);
    await expectAppError(paymentService.createPayment(CUSTOMER_ID, BOOKING_ID, { method: "CASH" }), 404);
  });

  it("returns 404 for another customer's booking", async () => {
    await expectAppError(paymentService.createPayment("someone-else", BOOKING_ID, { method: "CASH" }), 404);
    expect(repo.createPaymentIfNoneActive).not.toHaveBeenCalled();
  });

  it.each(["AWAITING_APPROVAL", "CANCELLED", "FAILED", "COMPLETED", "IN_PROGRESS"])(
    "returns 409 when the booking status is %s",
    async (status) => {
      repo.findBookingForPayment.mockResolvedValue(makeBooking({ status }));
      await expectAppError(paymentService.createPayment(CUSTOMER_ID, BOOKING_ID, { method: "CASH" }), 409);
    },
  );

  it("returns 409 when the booking still requires price approval", async () => {
    repo.findBookingForPayment.mockResolvedValue(makeBooking({ requiresApproval: true }));
    await expectAppError(paymentService.createPayment(CUSTOMER_ID, BOOKING_ID, { method: "CASH" }), 409);
  });

  it("returns 409 when the booking is already paid", async () => {
    repo.findBookingForPayment.mockResolvedValue(makeBooking({ paymentStatus: "PAID" }));
    await expectAppError(paymentService.createPayment(CUSTOMER_ID, BOOKING_ID, { method: "CASH" }), 409);
  });

  it("uses the booking price as the amount", async () => {
    await paymentService.createPayment(CUSTOMER_ID, BOOKING_ID, { method: "CASH" });
    expect(repo.createPaymentIfNoneActive).toHaveBeenCalledWith(expect.objectContaining({ amount: 450 }));
  });

  it("creates a SUBMITTED payment when a reference is given", async () => {
    await paymentService.createPayment(CUSTOMER_ID, BOOKING_ID, { method: "BANK_TRANSFER", reference: "TRX-1001" });
    expect(repo.createPaymentIfNoneActive).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SUBMITTED", reference: "TRX-1001" }),
    );
  });

  it("creates an INITIATED payment without a reference", async () => {
    await paymentService.createPayment(CUSTOMER_ID, BOOKING_ID, { method: "CASH" });
    expect(repo.createPaymentIfNoneActive).toHaveBeenCalledWith(expect.objectContaining({ status: "INITIATED" }));
  });

  it("returns 409 when an active payment already exists", async () => {
    repo.createPaymentIfNoneActive.mockResolvedValue(null);
    await expectAppError(paymentService.createPayment(CUSTOMER_ID, BOOKING_ID, { method: "CASH" }), 409);
  });

  it("returns 409 for a duplicate reference", async () => {
    repo.createPaymentIfNoneActive.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await expectAppError(
      paymentService.createPayment(CUSTOMER_ID, BOOKING_ID, { method: "BANK_TRANSFER", reference: "TRX-1001" }),
      409,
    );
  });
});

describe("paymentService.getCustomerPayment", () => {
  it("returns 404 for another customer's payment", async () => {
    repo.findPaymentById.mockResolvedValue(makePayment());
    await expectAppError(paymentService.getCustomerPayment("someone-else", PAYMENT_ID), 404);
  });
});

describe("paymentService.verifyPayment", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    repo.findPaymentById.mockResolvedValue(makePayment());
    repo.transitionPayment.mockResolvedValue(makePayment({ status: "VERIFIED" }));
  });

  it("returns 404 for an unknown payment", async () => {
    repo.findPaymentById.mockResolvedValue(null);
    await expectAppError(paymentService.verifyPayment(ADMIN_ID, PAYMENT_ID, { decision: "VERIFIED" }), 404);
  });

  it.each(["INITIATED", "VERIFIED", "REJECTED"])("returns 409 when the payment is %s", async (status) => {
    repo.findPaymentById.mockResolvedValue(makePayment({ status }));
    await expectAppError(paymentService.verifyPayment(ADMIN_ID, PAYMENT_ID, { decision: "VERIFIED" }), 409);
    expect(repo.transitionPayment).not.toHaveBeenCalled();
  });

  it("returns 409 when the amount no longer matches the booking price", async () => {
    repo.findPaymentById.mockResolvedValue(makePayment({ booking: { finalPrice: "400.00" } }));
    await expectAppError(paymentService.verifyPayment(ADMIN_ID, PAYMENT_ID, { decision: "VERIFIED" }), 409);
  });

  it("verifies a submitted payment", async () => {
    await paymentService.verifyPayment(ADMIN_ID, PAYMENT_ID, { decision: "VERIFIED" });
    expect(repo.transitionPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStatus: "SUBMITTED",
        toStatus: "VERIFIED",
        adminId: ADMIN_ID,
        action: "PAYMENT_VERIFIED",
        amount: 450,
      }),
    );
  });

  it("rejects even when the amount no longer matches", async () => {
    repo.findPaymentById.mockResolvedValue(makePayment({ booking: { finalPrice: "400.00" } }));
    await paymentService.verifyPayment(ADMIN_ID, PAYMENT_ID, { decision: "REJECTED", notes: "Wrong amount" });
    expect(repo.transitionPayment).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: "REJECTED", action: "PAYMENT_REJECTED" }),
    );
  });

  it("returns 409 when the payment changed during the update", async () => {
    repo.transitionPayment.mockResolvedValue(null);
    await expectAppError(paymentService.verifyPayment(ADMIN_ID, PAYMENT_ID, { decision: "VERIFIED" }), 409);
  });
});

describe("paymentService.recordPayment", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    repo.findPaymentById.mockResolvedValue(makePayment({ status: "INITIATED", reference: null }));
    repo.transitionPayment.mockResolvedValue(makePayment({ status: "VERIFIED" }));
  });

  it("returns 409 for a submitted receipt", async () => {
    repo.findPaymentById.mockResolvedValue(makePayment({ status: "SUBMITTED" }));
    await expectAppError(paymentService.recordPayment(ADMIN_ID, PAYMENT_ID, {}), 409);
  });

  it("returns 400 for a future received date", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await expectAppError(paymentService.recordPayment(ADMIN_ID, PAYMENT_ID, { receivedAt: future }), 400);
  });

  it("records an initiated payment as verified", async () => {
    await paymentService.recordPayment(ADMIN_ID, PAYMENT_ID, { reference: "RCPT-9", notes: "Cash at office" });
    expect(repo.transitionPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStatus: "INITIATED",
        toStatus: "VERIFIED",
        reference: "RCPT-9",
        action: "PAYMENT_RECORDED",
      }),
    );
  });

  it("returns 409 for a duplicate reference", async () => {
    repo.transitionPayment.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await expectAppError(paymentService.recordPayment(ADMIN_ID, PAYMENT_ID, { reference: "RCPT-9" }), 409);
  });
});