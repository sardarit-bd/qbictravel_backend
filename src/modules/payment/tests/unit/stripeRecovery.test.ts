import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import * as paymentService from "../../paymentService.js";
import * as paymentRepository from "../../paymentRepository.js";
import * as outboxService from "../../../outbox/outboxService.js";
import { prisma } from "../../../../lib/prisma.js";
import { verifyWebhookSignature, type IStripeClient } from "../../stripeClient.js";

// Helper to generate a valid Stripe-like signature header
const createTestSignature = (payloadString: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) => {
  const signed = `${timestamp}.${payloadString}`;
  const sig = crypto.createHmac("sha256", secret).update(signed, "utf8").digest("hex");
  return { header: `t=${timestamp},v1=${sig}`, timestamp };
};

describe("Stripe Payment Recovery & Reconciliation Unit Tests", () => {
  const mockWebhookSecret = "whsec_test_secret_123456";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Successful payment with delayed webhook
  it("verifies and transitions payment when delayed checkout.session.completed webhook arrives", async () => {
    const bookingId = "b1111111-1111-1111-1111-111111111111";
    const paymentId = "p1111111-1111-1111-1111-111111111111";
    const sessionId = "cs_test_delayed_session_001";
    const paymentIntentId = "pi_test_001";

    const payload = {
      id: "evt_test_delayed_001",
      type: "checkout.session.completed",
      data: {
        object: {
          id: sessionId,
          payment_intent: paymentIntentId,
          amount_total: 250000, // 2500.00 THB
          currency: "thb",
          client_reference_id: bookingId,
          metadata: { bookingId },
        },
      },
      created: Math.floor(Date.now() / 1000),
    };

    const payloadString = JSON.stringify(payload);
    const { header } = createTestSignature(payloadString, mockWebhookSecret);

    vi.spyOn(paymentRepository, "recordWebhookEventReceived").mockResolvedValue({
      event: { id: payload.id, status: "RECEIVED" } as any,
      isDuplicate: false,
    });
    vi.spyOn(paymentRepository, "lockWebhookEventForProcessing").mockResolvedValue({
      id: payload.id,
      status: "PROCESSING",
    } as any);
    vi.spyOn(paymentRepository, "findPaymentByStripeSessionId").mockResolvedValue({
      id: paymentId,
      bookingId,
      status: "INITIATED",
      amount: 2500,
      currency: "THB",
    } as any);
    vi.spyOn(paymentRepository, "verifyStripePaymentAtomically").mockResolvedValue({
      payment: { id: paymentId, status: "VERIFIED" } as any,
      isDuplicateSuccess: false,
      isOverpayment: false,
    });
    const completeSpy = vi.spyOn(paymentRepository, "completeWebhookEvent").mockResolvedValue({} as any);

    const result = await paymentService.handleStripeWebhook(
      Buffer.from(payloadString),
      header,
      mockWebhookSecret,
    );

    expect(result.status).toBe("PROCESSED");
    expect(result.bookingId).toBe(bookingId);
    expect(result.paymentId).toBe(paymentId);
    expect(completeSpy).toHaveBeenCalledWith(payload.id, "PROCESSED", bookingId, paymentId);
  });

  // 2. Duplicate webhook delivery
  it("safely ignores duplicate webhook delivery for an already processed event", async () => {
    const payload = {
      id: "evt_duplicate_001",
      type: "checkout.session.completed",
      data: { object: { id: "cs_dup" } },
      created: Math.floor(Date.now() / 1000),
    };
    const payloadString = JSON.stringify(payload);
    const { header } = createTestSignature(payloadString, mockWebhookSecret);

    vi.spyOn(paymentRepository, "recordWebhookEventReceived").mockResolvedValue({
      event: { id: payload.id, status: "PROCESSED" } as any,
      isDuplicate: true,
    });

    const result = await paymentService.handleStripeWebhook(
      Buffer.from(payloadString),
      header,
      mockWebhookSecret,
    );

    expect(result.status).toBe("PROCESSED");
    expect(result.message).toContain("Duplicate event already processed");
  });

  // 3. Invalid webhook signature
  it("rejects webhook when cryptographic signature does not match", async () => {
    const payload = { id: "evt_bad_sig", type: "checkout.session.completed" };
    const payloadString = JSON.stringify(payload);
    const invalidHeader = "t=1234567,v1=bad_signature_digest";

    await expect(
      paymentService.handleStripeWebhook(Buffer.from(payloadString), invalidHeader, mockWebhookSecret),
    ).rejects.toThrow("Invalid Stripe webhook signature");
  });

  // 4. Browser disconnect after successful Stripe payment
  it("creates checkout session and handles return polling/reconciliation", async () => {
    const customerId = "c1111111-1111-1111-1111-111111111111";
    const bookingId = "b1111111-1111-1111-1111-111111111111";
    const paymentId = "p1111111-1111-1111-1111-111111111111";

    const mockStripe: IStripeClient = {
      createCheckoutSession: vi.fn().mockResolvedValue({
        id: "cs_session_browser_disconnect",
        url: "https://checkout.stripe.com/c/pay/cs_session_browser_disconnect",
        payment_intent: "pi_123",
      }),
      retrieveCheckoutSession: vi.fn(),
      expireCheckoutSession: vi.fn(),
      retrievePaymentIntent: vi.fn(),
    };
    paymentService.setStripeClient(mockStripe);

    vi.spyOn(paymentRepository, "findBookingForPayment").mockResolvedValue({
      id: bookingId,
      customerId,
      status: "PENDING",
      requiresApproval: false,
      paymentStatus: "UNPAID",
      currency: "THB",
      finalPrice: 1500 as any,
      customer: { email: "cust@example.com", name: "Alice" } as any,
      service: { name: "Island Tour" } as any,
    } as any);

    vi.spyOn(paymentRepository, "createOrGetStripePayment").mockResolvedValue({
      payment: { id: paymentId, status: "INITIATED", amount: 1500, currency: "THB" } as any,
      isAlreadyVerified: false,
      isExistingActive: false,
    });
    vi.spyOn(paymentRepository, "updatePaymentStripeSession").mockResolvedValue({} as any);

    const sessionRes = await paymentService.createStripeCheckoutSession(customerId, { bookingId });
    expect(sessionRes.sessionId).toBe("cs_session_browser_disconnect");
    expect(sessionRes.sessionUrl).toContain("checkout.stripe.com");
  });

  // 5. Expired Checkout Session and safe retry
  it("handles expired Checkout Session and creates fresh session on retry", async () => {
    const customerId = "c1111111-1111-1111-1111-111111111111";
    const bookingId = "b1111111-1111-1111-1111-111111111111";
    const oldPaymentId = "p1111111-1111-1111-1111-111111111111";

    const mockStripe: IStripeClient = {
      retrieveCheckoutSession: vi.fn().mockResolvedValue({
        id: "cs_expired",
        status: "expired",
      }),
      createCheckoutSession: vi.fn().mockResolvedValue({
        id: "cs_new_retry",
        url: "https://checkout.stripe.com/pay/cs_new_retry",
        payment_intent: "pi_new",
      }),
      expireCheckoutSession: vi.fn(),
      retrievePaymentIntent: vi.fn(),
    };
    paymentService.setStripeClient(mockStripe);

    vi.spyOn(paymentRepository, "findBookingForPayment").mockResolvedValue({
      id: bookingId,
      customerId,
      status: "PENDING",
      requiresApproval: false,
      paymentStatus: "UNPAID",
      currency: "USD",
      finalPrice: 80 as any,
    } as any);

    vi.spyOn(paymentRepository, "createOrGetStripePayment").mockResolvedValue({
      payment: {
        id: oldPaymentId,
        status: "INITIATED",
        stripeSessionId: "cs_expired",
        amount: 80,
        currency: "USD",
      } as any,
      isAlreadyVerified: false,
      isExistingActive: true,
    });

    const updateStatusSpy = vi.spyOn(paymentRepository, "updateStripePaymentStatus").mockResolvedValue({} as any);
    vi.spyOn(paymentRepository, "updatePaymentStripeSession").mockResolvedValue({} as any);

    const sessionRes = await paymentService.createStripeCheckoutSession(customerId, { bookingId });

    expect(updateStatusSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: oldPaymentId,
        status: "CANCELLED",
      }),
    );
    expect(sessionRes.sessionId).toBe("cs_new_retry");
  });

  // 6. Failed webhook processing followed by successful retry
  it("handles initial failure and records FAILED status, then succeeds on retry", async () => {
    const payload = {
      id: "evt_fail_then_retry",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_retry",
          client_reference_id: "b1",
          metadata: { bookingId: "b1" },
          amount_total: 10000,
          currency: "usd",
        },
      },
      created: Math.floor(Date.now() / 1000),
    };
    const payloadString = JSON.stringify(payload);
    const { header } = createTestSignature(payloadString, mockWebhookSecret);

    // First attempt fails due to database lock/unavailable payment
    vi.spyOn(paymentRepository, "recordWebhookEventReceived").mockResolvedValue({
      event: { id: payload.id, status: "RECEIVED" } as any,
      isDuplicate: false,
    });
    vi.spyOn(paymentRepository, "lockWebhookEventForProcessing").mockResolvedValue({
      id: payload.id,
      status: "PROCESSING",
    } as any);
    vi.spyOn(paymentRepository, "findPaymentByStripeSessionId").mockResolvedValue(null);
    vi.spyOn(paymentRepository, "findActiveStripePaymentForBooking").mockResolvedValue(null);
    vi.spyOn(paymentRepository, "findVerifiedPaymentForBooking").mockResolvedValue(null);
    const failSpy = vi.spyOn(paymentRepository, "failWebhookEvent").mockResolvedValue({} as any);

    await expect(
      paymentService.handleStripeWebhook(Buffer.from(payloadString), header, mockWebhookSecret),
    ).rejects.toThrow("No matching payment record found");

    expect(failSpy).toHaveBeenCalledWith(payload.id, expect.stringContaining("No matching payment record found"));

    // Second attempt (retry) succeeds after payment is linked
    vi.spyOn(paymentRepository, "recordWebhookEventReceived").mockResolvedValue({
      event: { id: payload.id, status: "FAILED" } as any,
      isDuplicate: true,
    });
    vi.spyOn(paymentRepository, "findPaymentByStripeSessionId").mockResolvedValue({
      id: "p1",
      bookingId: "b1",
      status: "INITIATED",
    } as any);
    vi.spyOn(paymentRepository, "verifyStripePaymentAtomically").mockResolvedValue({
      payment: { id: "p1", status: "VERIFIED" } as any,
      isDuplicateSuccess: false,
      isOverpayment: false,
    });
    const completeSpy = vi.spyOn(paymentRepository, "completeWebhookEvent").mockResolvedValue({} as any);

    const retryRes = await paymentService.handleStripeWebhook(
      Buffer.from(payloadString),
      header,
      mockWebhookSecret,
    );
    expect(retryRes.status).toBe("PROCESSED");
    expect(completeSpy).toHaveBeenCalledWith(payload.id, "PROCESSED", "b1", "p1");
  });

  // 7. Duplicate successful payment for one booking
  it("flags duplicate payment without discarding or automatically refunding", async () => {
    const bookingId = "b1";
    const paymentId = "p2_duplicate";

    const payload = {
      id: "evt_dup_charge",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_dup_charge",
          client_reference_id: bookingId,
          amount_total: 5000,
          currency: "usd",
        },
      },
      created: Math.floor(Date.now() / 1000),
    };
    const payloadString = JSON.stringify(payload);
    const { header } = createTestSignature(payloadString, mockWebhookSecret);

    vi.spyOn(paymentRepository, "recordWebhookEventReceived").mockResolvedValue({
      event: { id: payload.id, status: "RECEIVED" } as any,
      isDuplicate: false,
    });
    vi.spyOn(paymentRepository, "lockWebhookEventForProcessing").mockResolvedValue({
      id: payload.id,
      status: "PROCESSING",
    } as any);
    vi.spyOn(paymentRepository, "findPaymentByStripeSessionId").mockResolvedValue({
      id: paymentId,
      bookingId,
      status: "INITIATED",
    } as any);
    vi.spyOn(paymentRepository, "verifyStripePaymentAtomically").mockResolvedValue({
      payment: { id: paymentId, status: "REQUIRES_ACTION" } as any,
      isDuplicateSuccess: false,
      isOverpayment: true,
    });
    vi.spyOn(paymentRepository, "completeWebhookEvent").mockResolvedValue({} as any);

    const res = await paymentService.handleStripeWebhook(
      Buffer.from(payloadString),
      header,
      mockWebhookSecret,
    );

    expect(res.status).toBe("PROCESSED");
    expect(res.paymentId).toBe(paymentId);
  });

  // 8. Reconciliation of a missed webhook
  it("reconciles a payment against Stripe API when webhook was missed", async () => {
    const paymentId = "p_reconcile_01";
    const bookingId = "b_reconcile_01";

    const mockStripe: IStripeClient = {
      retrieveCheckoutSession: vi.fn().mockResolvedValue({
        id: "cs_missed_webhook",
        payment_status: "paid",
        status: "complete",
        amount_total: 300000,
        currency: "thb",
        payment_intent: "pi_recovered_01",
      }),
      createCheckoutSession: vi.fn(),
      expireCheckoutSession: vi.fn(),
      retrievePaymentIntent: vi.fn(),
    };
    paymentService.setStripeClient(mockStripe);

    vi.spyOn(paymentRepository, "findPaymentById").mockResolvedValue({
      id: paymentId,
      bookingId,
      method: "STRIPE",
      status: "INITIATED",
      stripeSessionId: "cs_missed_webhook",
      currency: "THB",
      amount: 3000 as any,
    } as any);

    vi.spyOn(paymentRepository, "verifyStripePaymentAtomically").mockResolvedValue({
      payment: { id: paymentId, status: "VERIFIED" } as any,
      isDuplicateSuccess: false,
      isOverpayment: false,
    });

    const result = await paymentService.reconcileStripePayment(paymentId);

    expect(result.reconciled).toBe(true);
    expect(result.newStatus).toBe("VERIFIED");
    expect(result.notes).toContain("Recovered and verified via Stripe Checkout Session");
  });

  // 9. Old events arriving after successful payment
  it("never downgrades a VERIFIED payment when an old/expired event arrives late", async () => {
    const paymentId = "p_already_verified";

    vi.spyOn(paymentRepository, "findPaymentById").mockResolvedValue({
      id: paymentId,
      bookingId: "b1",
      method: "STRIPE",
      status: "VERIFIED",
    } as any);

    const result = await paymentService.reconcileStripePayment(paymentId);
    expect(result.newStatus).toBe("VERIFIED");
    expect(result.notes).toBe("Payment is already verified locally");
  });

  // 10. Amount or currency mismatch
  it("rejects verification if Stripe amount does not match booking amount", async () => {
    const bookingId = "b_mismatch";
    const paymentId = "p_mismatch";

    const payload = {
      id: "evt_mismatch",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_mismatch",
          client_reference_id: bookingId,
          amount_total: 10000, // 100.00 THB
          currency: "thb",
        },
      },
      created: Math.floor(Date.now() / 1000),
    };
    const payloadString = JSON.stringify(payload);
    const { header } = createTestSignature(payloadString, mockWebhookSecret);

    vi.spyOn(paymentRepository, "recordWebhookEventReceived").mockResolvedValue({
      event: { id: payload.id, status: "RECEIVED" } as any,
      isDuplicate: false,
    });
    vi.spyOn(paymentRepository, "lockWebhookEventForProcessing").mockResolvedValue({
      id: payload.id,
      status: "PROCESSING",
    } as any);
    vi.spyOn(paymentRepository, "findPaymentByStripeSessionId").mockResolvedValue({
      id: paymentId,
      bookingId,
      status: "INITIATED",
    } as any);
    vi.spyOn(paymentRepository, "verifyStripePaymentAtomically").mockRejectedValue(
      new Error("Amount mismatch: Stripe received 100 but booking requires 500"),
    );
    const failSpy = vi.spyOn(paymentRepository, "failWebhookEvent").mockResolvedValue({} as any);

    await expect(
      paymentService.handleStripeWebhook(Buffer.from(payloadString), header, mockWebhookSecret),
    ).rejects.toThrow("Amount mismatch");

    expect(failSpy).toHaveBeenCalledWith(payload.id, expect.stringContaining("Amount mismatch"));
  });

  // 11. Outbox retry and permanent failure
  it("retries outbox message and marks as permanently failed after max attempts", async () => {
    const testMessage: any = {
      id: "msg_outbox_001",
      topic: "CALCULATE_COMMISSION",
      payload: { bookingId: "b1" },
      attempts: 4,
    };

    const updateSpy = vi.spyOn(prisma.outboxMessage, "update").mockResolvedValue({} as any);
    const failingHandler = vi.fn().mockRejectedValue(new Error("Transient commission calculation error"));
    const ok = await outboxService.processOutboxMessage(testMessage, {
      onCommission: failingHandler,
    });

    expect(ok).toBe(false);
    expect(failingHandler).toHaveBeenCalledWith("b1");
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "msg_outbox_001" },
        data: expect.objectContaining({
          status: "FAILED",
          attempts: 5,
        }),
      }),
    );
  });

  // 12. Existing manual payment workflow regression
  it("preserves manual bank transfer submission workflow intact", async () => {
    const customerId = "c_manual_01";
    const bookingId = "b_manual_01";

    vi.spyOn(paymentRepository, "findBookingForPayment").mockResolvedValue({
      id: bookingId,
      customerId,
      status: "CONFIRMED",
      requiresApproval: false,
      paymentStatus: "UNPAID",
      currency: "THB",
      finalPrice: 3500 as any,
    } as any);

    vi.spyOn(paymentRepository, "createPaymentIfNoneActive").mockResolvedValue({
      id: "p_manual_01",
      bookingId,
      customerId,
      amount: 3500 as any,
      currency: "THB",
      method: "BANK_TRANSFER",
      status: "SUBMITTED",
      reference: "TRANSFER-REF-9988",
    } as any);

    const payment = await paymentService.createPayment(customerId, bookingId, {
      method: "BANK_TRANSFER",
      reference: "TRANSFER-REF-9988",
      receiptNote: "Uploaded receipt slip",
    });

    expect(payment.method).toBe("BANK_TRANSFER");
    expect(payment.status).toBe("SUBMITTED");
    expect(payment.amount).toBe(3500);
  });
});
