import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  createUser,
  loginAgent,
  prisma,
  resetDatabase,
} from "../../../../test/helpers.js";
import * as paymentService from "../../paymentService.js";
import { OmiseClient } from "../../omiseClient.js";
import { generateSecureToken, hashToken } from "../../tokenUtils.js";
import { invalidateRuntimeConfigCache } from "../../../setting/settingRuntimeConfig.js";
import crypto from "crypto";

describe("Phase 3: Omise API Routes & Controllers Integration", () => {
  let customer: any;
  let customerSession: any;
  let otherCustomer: any;
  let otherCustomerSession: any;
  let service: any;
  let booking: any;
  let mockOmiseClient: OmiseClient;

  beforeEach(async () => {
    await resetDatabase();
    invalidateRuntimeConfigCache();

    customer = await createUser({ role: "customer", name: "Alice Customer" });
    customerSession = await loginAgent(customer.email);

    otherCustomer = await createUser({ role: "customer", name: "Bob Customer" });
    otherCustomerSession = await loginAgent(otherCustomer.email);

    service = await prisma.service.create({
      data: {
        name: "Phuket Luxury Yacht Tour",
        type: "TOUR",
      },
    });

    booking = await prisma.booking.create({
      data: {
        customerId: customer.id,
        serviceId: service.id,
        currency: "THB",
        basePrice: 5000,
        finalPrice: 5000,
        status: "PENDING",
        paymentStatus: "UNPAID",
      },
    });

    mockOmiseClient = new OmiseClient({
      publicKey: "pkey_test_phase3",
      secretKey: "skey_test_phase3",
      webhookSecret: "whsec_test_phase3",
      baseUrl: "https://api.omise.co",
    });

    paymentService.setOmiseClient(mockOmiseClient);
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /api/v1/bookings/:bookingId/omise-charge", () => {
    it("creates an immediate verified payment for non-3DS card", async () => {
      vi.spyOn(mockOmiseClient, "createCardCharge").mockResolvedValue({
        object: "charge",
        id: "chrg_test_route_1",
        location: "/charges/chrg_test_route_1",
        amount: 500000,
        currency: "thb",
        status: "successful",
        authorized: true,
        paid: true,
        transaction: "trns_test_route_1",
        created_at: new Date().toISOString(),
      });

      const res = await customerSession
        .post(`/api/v1/bookings/${booking.id}/omise-charge`)
        .send({ token: "tokn_test_route_token" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("VERIFIED");
      expect(res.body.data.requiresAction).toBe(false);
      expect(res.body.data.amount).toBe(5000);
      expect(res.body.data.omiseChargeId).toBe("chrg_test_route_1");

      const refreshed = await prisma.booking.findUnique({ where: { id: booking.id } });
      expect(refreshed?.paymentStatus).toBe("PAID");
      expect(refreshed?.status).toBe("CONFIRMED");
    });

    it("returns 3DS challenge URL when card requires 3DS authorization", async () => {
      vi.spyOn(mockOmiseClient, "createCardCharge").mockResolvedValue({
        object: "charge",
        id: "chrg_test_route_3ds",
        location: "/charges/chrg_test_route_3ds",
        amount: 500000,
        currency: "thb",
        status: "pending",
        authorized: false,
        paid: false,
        authorize_uri: "https://api.omise.co/charges/chrg_test_route_3ds/authorize",
        created_at: new Date().toISOString(),
      });

      const res = await customerSession
        .post(`/api/v1/bookings/${booking.id}/omise-charge`)
        .send({ token: "tokn_test_3ds_route" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("REQUIRES_ACTION");
      expect(res.body.data.requiresAction).toBe(true);
      expect(res.body.data.authorizeUri).toBe("https://api.omise.co/charges/chrg_test_route_3ds/authorize");
    });

    it("returns 403 when attempting to pay for another user's booking", async () => {
      const res = await otherCustomerSession
        .post(`/api/v1/bookings/${booking.id}/omise-charge`)
        .send({ token: "tokn_test_intruder" });

      expect(res.status).toBe(403);
    });

    it("returns 400 when invalid token format is supplied", async () => {
      const res = await customerSession
        .post(`/api/v1/bookings/${booking.id}/omise-charge`)
        .send({ token: "invalid_prefix_token" });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Token must be a valid Omise card token");
    });
  });

  describe("POST /api/v1/payments/:paymentId/omise-verify", () => {
    it("verifies live payment upon customer return from 3DS authorization", async () => {
      // 1. Initiate 3DS
      vi.spyOn(mockOmiseClient, "createCardCharge").mockResolvedValue({
        object: "charge",
        id: "chrg_test_ret_check",
        location: "/charges/chrg_test_ret_check",
        amount: 500000,
        currency: "thb",
        status: "pending",
        authorized: false,
        paid: false,
        authorize_uri: "https://api.omise.co/charges/chrg_test_ret_check/authorize",
        created_at: new Date().toISOString(),
      });

      const initRes = await customerSession
        .post(`/api/v1/bookings/${booking.id}/omise-charge`)
        .send({ token: "tokn_test_3ds_init" });

      const paymentId = initRes.body.data.paymentId;

      // 2. Authoritative check returns successful
      vi.spyOn(mockOmiseClient, "retrieveCharge").mockResolvedValue({
        object: "charge",
        id: "chrg_test_ret_check",
        location: "/charges/chrg_test_ret_check",
        amount: 500000,
        currency: "thb",
        status: "successful",
        authorized: true,
        paid: true,
        transaction: "trns_test_ret",
        created_at: new Date().toISOString(),
      });

      const verifyRes = await customerSession
        .post(`/api/v1/payments/${paymentId}/omise-verify`)
        .send();

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.verified).toBe(true);
      expect(verifyRes.body.data.status).toBe("VERIFIED");

      // Repeated call returns safe success
      const repeatRes = await customerSession
        .post(`/api/v1/payments/${paymentId}/omise-verify`)
        .send();

      expect(repeatRes.status).toBe(200);
      expect(repeatRes.body.data.verified).toBe(true);
    });

    it("returns 404 for unauthenticated user or non-existent payment", async () => {
      const res = await api().post("/api/v1/payments/00000000-0000-0000-0000-000000000000/omise-verify");
      expect(res.status).toBe(401);
    });
  });

  describe("Public Payment Link Omise Flow", () => {
    let rawToken: string;
    let paymentLink: any;

    beforeEach(async () => {
      rawToken = generateSecureToken();
      paymentLink = await prisma.paymentLink.create({
        data: {
          bookingId: booking.id,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 86400000), // 1 day future
          status: "ACTIVE",
        },
      });
    });

    it("creates a charge via public payment link token", async () => {
      vi.spyOn(mockOmiseClient, "createCardCharge").mockResolvedValue({
        object: "charge",
        id: "chrg_test_pub_1",
        location: "/charges/chrg_test_pub_1",
        amount: 500000,
        currency: "thb",
        status: "successful",
        authorized: true,
        paid: true,
        transaction: "trns_test_pub_1",
        created_at: new Date().toISOString(),
      });

      const res = await api()
        .post(`/api/v1/public/payment-links/${rawToken}/omise-charge`)
        .send({ token: "tokn_test_public_card" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("VERIFIED");
      expect(res.body.data.omiseChargeId).toBe("chrg_test_pub_1");
    });

    it("verifies public payment link return status", async () => {
      // 1. Create 3DS payment
      vi.spyOn(mockOmiseClient, "createCardCharge").mockResolvedValue({
        object: "charge",
        id: "chrg_test_pub_3ds",
        location: "/charges/chrg_test_pub_3ds",
        amount: 500000,
        currency: "thb",
        status: "pending",
        authorized: false,
        paid: false,
        authorize_uri: "https://api.omise.co/charges/chrg_test_pub_3ds/authorize",
        created_at: new Date().toISOString(),
      });

      const initRes = await api()
        .post(`/api/v1/public/payment-links/${rawToken}/omise-charge`)
        .send({ token: "tokn_test_pub_3ds" });

      const paymentId = initRes.body.data.paymentId;

      // 2. Authoritative retrieval returns success
      vi.spyOn(mockOmiseClient, "retrieveCharge").mockResolvedValue({
        object: "charge",
        id: "chrg_test_pub_3ds",
        location: "/charges/chrg_test_pub_3ds",
        amount: 500000,
        currency: "thb",
        status: "successful",
        authorized: true,
        paid: true,
        created_at: new Date().toISOString(),
      });

      const verifyRes = await api()
        .post(`/api/v1/public/payment-links/${rawToken}/omise-verify`)
        .send({ paymentId });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.verified).toBe(true);
      expect(verifyRes.body.data.status).toBe("VERIFIED");
    });

    it("returns 400 when public payment link has expired", async () => {
      await prisma.paymentLink.update({
        where: { id: paymentLink.id },
        data: { expiresAt: new Date(Date.now() - 3600000) },
      });

      const res = await api()
        .post(`/api/v1/public/payment-links/${rawToken}/omise-charge`)
        .send({ token: "tokn_test_valid" });

      expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent public payment token", async () => {
      const res = await api()
        .post("/api/v1/public/payment-links/nonexistenttokennonexistenttoken1234/omise-charge")
        .send({ token: "tokn_test_valid" });

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/v1/webhooks/omise", () => {
    it("handles webhook route with raw body HMAC verification and returns 200", async () => {
      vi.spyOn(mockOmiseClient, "createCardCharge").mockResolvedValue({
        object: "charge",
        id: "chrg_test_wh_api",
        location: "/charges/chrg_test_wh_api",
        amount: 500000,
        currency: "thb",
        status: "pending",
        authorized: false,
        paid: false,
        authorize_uri: "https://api.omise.co/charges/chrg_test_wh_api/authorize",
        created_at: new Date().toISOString(),
      });

      await customerSession
        .post(`/api/v1/bookings/${booking.id}/omise-charge`)
        .send({ token: "tokn_test_wh_token" });

      vi.spyOn(mockOmiseClient, "retrieveCharge").mockResolvedValue({
        object: "charge",
        id: "chrg_test_wh_api",
        location: "/charges/chrg_test_wh_api",
        amount: 500000,
        currency: "thb",
        status: "successful",
        authorized: true,
        paid: true,
        transaction: "trns_test_wh_api",
        created_at: new Date().toISOString(),
      });

      const payload = JSON.stringify({
        object: "event",
        id: "evnt_test_route_wh_1",
        key: "charge.complete",
        data: { id: "chrg_test_wh_api" },
      });

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signedPayload = `${timestamp}.${payload}`;
      const rawSecretBuf = Buffer.from("whsec_test_phase3", "utf8");

      const signature = crypto
        .createHmac("sha256", rawSecretBuf)
        .update(signedPayload, "utf8")
        .digest("hex");

      const res = await api()
        .post("/api/v1/webhooks/omise")
        .set("Content-Type", "application/json")
        .set("omise-signature", signature)
        .set("omise-signature-timestamp", timestamp)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("PROCESSED");
    });

    it("rejects webhook route when signature is invalid and returns 400", async () => {
      const payload = JSON.stringify({
        object: "event",
        id: "evnt_test_route_wh_bad",
        key: "charge.complete",
        data: { id: "chrg_test_bad" },
      });

      const res = await api()
        .post("/api/v1/webhooks/omise")
        .set("Content-Type", "application/json")
        .set("omise-signature", "invalid_signature_hex")
        .set("omise-signature-timestamp", Math.floor(Date.now() / 1000).toString())
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Invalid Omise webhook signature");
    });
  });

  describe("Admin Omise Gateway Enable/Disable Enforcement", () => {
    it("rejects customer payment with 400 when Omise gateway is disabled by admin", async () => {
      const freshCustomer = await createUser({ role: "customer", name: "David Customer" });
      const freshSession = await loginAgent(freshCustomer.email);

      const freshBooking = await prisma.booking.create({
        data: {
          customerId: freshCustomer.id,
          serviceId: service.id,
          currency: "THB",
          basePrice: 5000,
          finalPrice: 5000,
          status: "PENDING",
          paymentStatus: "UNPAID",
        },
      });

      // Disable omise in system settings
      await prisma.systemSetting.upsert({
        where: { key: "payment.omise.enabled" },
        update: { value: "false" },
        create: {
          key: "payment.omise.enabled",
          value: "false",
          category: "PAYMENT",
          isSecret: false,
        },
      });
      invalidateRuntimeConfigCache();

      const res = await freshSession
        .post(`/api/v1/bookings/${freshBooking.id}/omise-charge`)
        .send({ token: "tokn_test_123" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Omise card payments are currently disabled by administrator");
    });
  });
});
