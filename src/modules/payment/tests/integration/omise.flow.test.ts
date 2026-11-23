import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  createUser,
  loginAgent,
  prisma,
  resetDatabase,
} from "../../../../test/helpers.js";
import * as paymentService from "../../paymentService.js";
import { OmiseClient, OmiseError } from "../../omiseClient.js";
import crypto from "crypto";

describe("Phase 2: Omise Payment Lifecycle & Settlement", () => {
  let customer: any;
  let admin: any;
  let service: any;
  let booking: any;
  let mockOmiseClient: OmiseClient;

  beforeEach(async () => {
    await resetDatabase();

    customer = await createUser({ role: "customer", name: "Omise Customer" });
    admin = await createUser({ role: "admin", name: "Admin Manager" });

    // Create service
    service = await prisma.service.create({
      data: {
        name: "Phi Phi Island Day Trip",
        type: "TOUR",
      },
    });

    // Create booking in THB
    booking = await prisma.booking.create({
      data: {
        customerId: customer.id,
        serviceId: service.id,
        currency: "THB",
        basePrice: 2500,
        finalPrice: 2500,
        status: "PENDING",
        paymentStatus: "UNPAID",
      },
    });

    mockOmiseClient = new OmiseClient({
      publicKey: "pkey_test_123",
      secretKey: "skey_test_123",
      webhookSecret: "whsec_test_secret",
      baseUrl: "https://api.omise.co",
    });

    paymentService.setOmiseClient(mockOmiseClient);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles successful immediate non-3DS payment and auto-confirms booking", async () => {
    vi.spyOn(mockOmiseClient, "createCardCharge").mockResolvedValue({
      object: "charge",
      id: "chrg_test_non3ds_999",
      location: "/charges/chrg_test_non3ds_999",
      amount: 250000,
      currency: "thb",
      status: "successful",
      authorized: true,
      paid: true,
      authorize_uri: null,
      transaction: "trns_test_1",
      created_at: new Date().toISOString(),
    });

    const result = await paymentService.createCustomerOmiseCharge(customer.id, {
      bookingId: booking.id,
      token: "tokn_test_valid_card",
    });

    expect(result.status).toBe("VERIFIED");
    expect(result.requiresAction).toBe(false);
    expect(result.omiseChargeId).toBe("chrg_test_non3ds_999");
    expect(result.amount).toBe(2500);

    // Verify booking is confirmed and paid
    const updatedBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(updatedBooking?.paymentStatus).toBe("PAID");
    expect(updatedBooking?.status).toBe("CONFIRMED");

    // Verify payment record in DB
    const paymentRecord = await prisma.payment.findUnique({ where: { id: result.paymentId } });
    expect(paymentRecord?.status).toBe("VERIFIED");
    expect(paymentRecord?.omiseChargeId).toBe("chrg_test_non3ds_999");
    expect(paymentRecord?.method).toBe("OMISE");
  });

  it("handles 3-D Secure pending charge and returns authorizeUri", async () => {
    vi.spyOn(mockOmiseClient, "createCardCharge").mockResolvedValue({
      object: "charge",
      id: "chrg_test_3ds_888",
      location: "/charges/chrg_test_3ds_888",
      amount: 250000,
      currency: "thb",
      status: "pending",
      authorized: false,
      paid: false,
      authorize_uri: "https://api.omise.co/charges/chrg_test_3ds_888/authorize",
      return_uri: "https://localhost:3000/checkout/omise-return",
      created_at: new Date().toISOString(),
    });

    const result = await paymentService.createCustomerOmiseCharge(customer.id, {
      bookingId: booking.id,
      token: "tokn_test_3ds_card",
    });

    expect(result.status).toBe("REQUIRES_ACTION");
    expect(result.requiresAction).toBe(true);
    expect(result.authorizeUri).toBe("https://api.omise.co/charges/chrg_test_3ds_888/authorize");

    // Booking remains PENDING / UNPAID until verified
    const freshBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(freshBooking?.paymentStatus).toBe("UNPAID");
    expect(freshBooking?.status).toBe("PENDING");

    // Payment record is in REQUIRES_ACTION with omiseChargeId stored
    const paymentRecord = await prisma.payment.findUnique({ where: { id: result.paymentId } });
    expect(paymentRecord?.status).toBe("REQUIRES_ACTION");
    expect(paymentRecord?.omiseChargeId).toBe("chrg_test_3ds_888");
  });

  it("reconciles payment upon 3DS return verification against authoritative Omise API", async () => {
    // 1. Initial 3DS initiation
    vi.spyOn(mockOmiseClient, "createCardCharge").mockResolvedValue({
      object: "charge",
      id: "chrg_test_return_777",
      location: "/charges/chrg_test_return_777",
      amount: 250000,
      currency: "thb",
      status: "pending",
      authorized: false,
      paid: false,
      authorize_uri: "https://api.omise.co/charges/chrg_test_return_777/authorize",
      created_at: new Date().toISOString(),
    });

    const chargeResult = await paymentService.createCustomerOmiseCharge(customer.id, {
      bookingId: booking.id,
      token: "tokn_test_return_token",
    });

    // 2. Mock Omise API retrieve showing payment was completed at bank
    vi.spyOn(mockOmiseClient, "retrieveCharge").mockResolvedValue({
      object: "charge",
      id: "chrg_test_return_777",
      location: "/charges/chrg_test_return_777",
      amount: 250000,
      currency: "thb",
      status: "successful",
      authorized: true,
      paid: true,
      created_at: new Date().toISOString(),
    });

    // 3. Customer returns to frontend which calls return verification
    const verifyResult = await paymentService.verifyOmiseChargeReturn(chargeResult.paymentId, {
      id: customer.id,
      role: "customer",
    });

    expect(verifyResult.verified).toBe(true);
    expect(verifyResult.status).toBe("VERIFIED");

    // Booking is now confirmed
    const updatedBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(updatedBooking?.paymentStatus).toBe("PAID");
    expect(updatedBooking?.status).toBe("CONFIRMED");

    // Repeated return call is idempotent and safe
    const secondCall = await paymentService.verifyOmiseChargeReturn(chargeResult.paymentId, {
      id: customer.id,
      role: "customer",
    });
    expect(secondCall.verified).toBe(true);
    expect(secondCall.status).toBe("VERIFIED");
  });

  it("handles failed or declined card charges properly", async () => {
    vi.spyOn(mockOmiseClient, "createCardCharge").mockResolvedValue({
      object: "charge",
      id: "chrg_test_failed_666",
      location: "/charges/chrg_test_failed_666",
      amount: 250000,
      currency: "thb",
      status: "failed",
      authorized: false,
      paid: false,
      failure_message: "Insufficient funds in account",
      created_at: new Date().toISOString(),
    });

    await expect(
      paymentService.createCustomerOmiseCharge(customer.id, {
        bookingId: booking.id,
        token: "tokn_test_declined",
      })
    ).rejects.toThrow(/Insufficient funds/);

    // Payment marked FAILED in DB
    const failedPayment = await prisma.payment.findFirst({
      where: { bookingId: booking.id, method: "OMISE" },
    });
    expect(failedPayment?.status).toBe("FAILED");
    expect(failedPayment?.failureReason).toBe("Insufficient funds in account");
  });

  it("rejects non-THB bookings with clear currency error", async () => {
    const usdBooking = await prisma.booking.create({
      data: {
        customerId: customer.id,
        serviceId: service.id,
        currency: "USD",
        basePrice: 100,
        finalPrice: 100,
        status: "PENDING",
        paymentStatus: "UNPAID",
      },
    });

    await expect(
      paymentService.createCustomerOmiseCharge(customer.id, {
        bookingId: usdBooking.id,
        token: "tokn_test_usd_card",
      })
    ).rejects.toThrow(/only support THB currency/);
  });

  it("prevents customer from paying for another user's booking", async () => {
    const anotherUser = await createUser({ role: "customer", name: "Another Customer" });

    await expect(
      paymentService.createCustomerOmiseCharge(anotherUser.id, {
        bookingId: booking.id,
        token: "tokn_test_intruder",
      })
    ).rejects.toThrow(/do not have access/);
  });

  it("processes charge.complete webhook idempotently", async () => {
    // 1. Create initial 3DS payment
    vi.spyOn(mockOmiseClient, "createCardCharge").mockResolvedValue({
      object: "charge",
      id: "chrg_test_wh_555",
      location: "/charges/chrg_test_wh_555",
      amount: 250000,
      currency: "thb",
      status: "pending",
      authorized: false,
      paid: false,
      authorize_uri: "https://api.omise.co/charges/chrg_test_wh_555/authorize",
      created_at: new Date().toISOString(),
    });

    await paymentService.createCustomerOmiseCharge(customer.id, {
      bookingId: booking.id,
      token: "tokn_test_wh_token",
    });

    // 2. Mock retrieveCharge
    vi.spyOn(mockOmiseClient, "retrieveCharge").mockResolvedValue({
      object: "charge",
      id: "chrg_test_wh_555",
      location: "/charges/chrg_test_wh_555",
      amount: 250000,
      currency: "thb",
      status: "successful",
      authorized: true,
      paid: true,
      transaction: "trns_test_wh",
      created_at: new Date().toISOString(),
    });

    const webhookSecret = "whsec_test_secret";
    const payload = JSON.stringify({
      object: "event",
      id: "evnt_test_wh_123",
      key: "charge.complete",
      data: {
        id: "chrg_test_wh_555",
        status: "successful",
      },
    });

    const signature = crypto
      .createHmac("sha256", webhookSecret)
      .update(payload, "utf8")
      .digest("hex");

    // 3. Process webhook
    const res = await paymentService.handleOmiseWebhook(Buffer.from(payload), signature, webhookSecret);
    expect(res.status).toBe("PROCESSED");

    // Verify booking is confirmed
    const finalBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(finalBooking?.paymentStatus).toBe("PAID");
    expect(finalBooking?.status).toBe("CONFIRMED");

    // 4. Repeated webhook delivery is idempotent
    const duplicateRes = await paymentService.handleOmiseWebhook(Buffer.from(payload), signature, webhookSecret);
    expect(duplicateRes.status).toBe("PROCESSED");
  });

  it("rejects webhooks with invalid HMAC signatures", async () => {
    const payload = JSON.stringify({
      object: "event",
      id: "evnt_test_bad",
      key: "charge.complete",
    });

    await expect(
      paymentService.handleOmiseWebhook(Buffer.from(payload), "invalid_signature", "whsec_test_secret")
    ).rejects.toThrow(/Invalid Omise webhook signature/);
  });

  it("handles Omise refund creation safely", async () => {
    // 1. First complete a payment
    vi.spyOn(mockOmiseClient, "createCardCharge").mockResolvedValue({
      object: "charge",
      id: "chrg_test_refund_444",
      location: "/charges/chrg_test_refund_444",
      amount: 250000,
      currency: "thb",
      status: "successful",
      authorized: true,
      paid: true,
      created_at: new Date().toISOString(),
    });

    const paymentRes = await paymentService.createCustomerOmiseCharge(customer.id, {
      bookingId: booking.id,
      token: "tokn_test_refund_card",
    });

    // 2. Mock Omise refund API
    vi.spyOn(mockOmiseClient, "createRefund").mockResolvedValue({
      object: "refund",
      id: "rfnd_test_444",
      location: "/charges/chrg_test_refund_444/refunds/rfnd_test_444",
      amount: 250000,
      currency: "thb",
      charge: "chrg_test_refund_444",
      voided: false,
      created_at: new Date().toISOString(),
    });

    // 3. Issue full refund
    const refundResult = await paymentService.refundOmisePayment(
      paymentRes.paymentId,
      { reason: "Customer changed itinerary" },
      admin.id
    );

    expect(refundResult.status).toBe("SUCCEEDED");
    expect(refundResult.refundId).toBe("rfnd_test_444");
    expect(refundResult.amount).toBe(2500);

    // Verify payment record transitioned to REFUNDED
    const refundedPayment = await prisma.payment.findUnique({ where: { id: paymentRes.paymentId } });
    expect(refundedPayment?.status).toBe("REFUNDED");

    // Booking payment status reverted to UNPAID
    const refundedBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
    expect(refundedBooking?.paymentStatus).toBe("UNPAID");
  });
});
