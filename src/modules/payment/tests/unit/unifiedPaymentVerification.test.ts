import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../../../../lib/prisma.js";
import * as paymentRepository from "../../paymentRepository.js";
import * as notificationRepository from "../../../notification/notificationRepository.js";
import * as notificationService from "../../../notification/notificationService.js";
import * as outboxService from "../../../outbox/outboxService.js";
import * as mailer from "../../../../shared/utils/mailer.js";

describe("Unified Payment Verification & Outbox Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Outbox Deduplication & Idempotency", () => {
    it("skips enqueuing duplicate outbox messages when dedupeKey already exists", async () => {
      const mockExistingMessage = {
        id: "outbox-existing-1",
        topic: "SEND_BOOKING_VOUCHER_EMAIL",
        payload: { bookingId: "b-1", dedupeKey: "voucher_email:p-1" },
        status: "PENDING",
      };

      const mockClient = {
        outboxMessage: {
          findFirst: vi.fn().mockResolvedValue(mockExistingMessage),
          create: vi.fn(),
        },
      };

      const result = await outboxService.enqueueOutboxMessage(mockClient as any, {
        topic: "SEND_BOOKING_VOUCHER_EMAIL" as any,
        payload: { bookingId: "b-1" },
        dedupeKey: "voucher_email:p-1",
      });

      expect(result.id).toBe("outbox-existing-1");
      expect(mockClient.outboxMessage.create).not.toHaveBeenCalled();
    });

    it("creates a new outbox message when dedupeKey is not yet present", async () => {
      const mockCreatedMessage = {
        id: "outbox-new-1",
        topic: "SEND_BOOKING_VOUCHER_EMAIL",
        payload: { bookingId: "b-2", dedupeKey: "voucher_email:p-2" },
        status: "PENDING",
      };

      const mockClient = {
        outboxMessage: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(mockCreatedMessage),
        },
      };

      const result = await outboxService.enqueueOutboxMessage(mockClient as any, {
        topic: "SEND_BOOKING_VOUCHER_EMAIL" as any,
        payload: { bookingId: "b-2" },
        dedupeKey: "voucher_email:p-2",
      });

      expect(result.id).toBe("outbox-new-1");
      expect(mockClient.outboxMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            topic: "SEND_BOOKING_VOUCHER_EMAIL",
            payload: { bookingId: "b-2", dedupeKey: "voucher_email:p-2" },
          }),
        }),
      );
    });
  });

  describe("Recipient Resolution for Guest Bookings vs Authenticated Customers", () => {
    it("resolves guest snapshot name and email for guest booking without exposing customer credentials", async () => {
      const mockBooking = {
        id: "b-guest-1",
        status: "CONFIRMED",
        paymentStatus: "PAID",
        fulfillmentStatus: "NOT_ASSIGNED",
        isGuest: true,
        service: { name: "James Bond Island Tour" },
        customer: { id: "shadow-cust-1", name: "Shadow User", email: "guest@example.com", status: "active" },
        agent: null,
        guestSnapshot: {
          guestName: "Guest Traveler",
          guestEmail: "guest@example.com",
          guestPhone: "+66812345678",
        },
      };

      vi.spyOn(notificationRepository, "findSetting").mockResolvedValue({ enabled: true } as any);
      vi.spyOn(notificationRepository, "findBookingRecipients").mockResolvedValue(mockBooking as any);
      const sendEmailSpy = vi.spyOn(mailer, "sendEmail").mockResolvedValue(undefined as any);

      await notificationService.notifyPaymentDecision("b-guest-1", "CONFIRMED");

      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "guest@example.com",
          text: expect.stringContaining("Hello Guest Traveler"),
        }),
      );
      // Ensure Shadow Customer's name wasn't used
      expect(sendEmailSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("Shadow User"),
        }),
      );
    });

    it("resolves authenticated customer profile name and email when isGuest is false", async () => {
      const mockBooking = {
        id: "b-auth-1",
        status: "CONFIRMED",
        paymentStatus: "PAID",
        fulfillmentStatus: "NOT_ASSIGNED",
        isGuest: false,
        service: { name: "Phi Phi Luxury Island Tour" },
        customer: { id: "cust-real-1", name: "Alice Wonderland", email: "alice@example.com", status: "active" },
        agent: null,
        guestSnapshot: null,
      };

      vi.spyOn(notificationRepository, "findSetting").mockResolvedValue({ enabled: true } as any);
      vi.spyOn(notificationRepository, "findBookingRecipients").mockResolvedValue(mockBooking as any);
      const sendEmailSpy = vi.spyOn(mailer, "sendEmail").mockResolvedValue(undefined as any);

      await notificationService.notifyPaymentDecision("b-auth-1", "CONFIRMED");

      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "alice@example.com",
          text: expect.stringContaining("Hello Alice Wonderland"),
        }),
      );
    });
  });

  describe("PayPal Payment Verification Pipeline", () => {
    it("enqueues outbox commission calculation and voucher email upon verified PayPal capture", async () => {
      const mockBooking = {
        id: "b-paypal-1",
        status: "PENDING",
        paymentStatus: "UNPAID",
        agentId: null,
        finalPrice: 150,
        payments: [],
      };

      const mockPayment = {
        id: "p-paypal-1",
        bookingId: "b-paypal-1",
        customerId: "c-1",
        amount: 150,
        currency: "USD",
        status: "VERIFIED",
      };

      const enqueuedOutbox: any[] = [];

      vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
        const tx = {
          payment: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue(mockPayment),
            update: vi.fn().mockResolvedValue(mockPayment),
          },
          booking: {
            findUnique: vi.fn().mockResolvedValue(mockBooking),
            update: vi.fn().mockResolvedValue({ ...mockBooking, paymentStatus: "PAID", status: "CONFIRMED" }),
          },
          bookingHistory: {
            create: vi.fn().mockResolvedValue({}),
          },
          paymentLink: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          outboxMessage: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockImplementation((args: any) => {
              enqueuedOutbox.push(args.data);
              return { id: `outbox-${enqueuedOutbox.length}`, ...args.data };
            }),
          },
        };
        return callback(tx);
      });

      const res = await paymentRepository.recordVerifiedPayPalPayment({
        bookingId: "b-paypal-1",
        customerId: "c-1",
        amount: 150,
        currency: "USD",
        paypalOrderId: "order-paypal-123",
        paypalCaptureId: "capture-paypal-456",
      });

      expect(res.isDuplicate).toBe(false);
      expect(enqueuedOutbox).toHaveLength(2);
      expect(enqueuedOutbox).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            topic: "CALCULATE_COMMISSION",
            payload: expect.objectContaining({
              bookingId: "b-paypal-1",
              paymentId: "p-paypal-1",
              dedupeKey: "commission:p-paypal-1",
            }),
          }),
          expect.objectContaining({
            topic: "SEND_BOOKING_VOUCHER_EMAIL",
            payload: expect.objectContaining({
              bookingId: "b-paypal-1",
              decision: "CONFIRMED",
              dedupeKey: "voucher_email:p-paypal-1",
            }),
          }),
        ]),
      );
    });
  });

  describe("Outbox Worker Retries and Exponential Backoff", () => {
    it("increments attempts and calculates exponential backoff on failure", async () => {
      const mockMessage = {
        id: "msg-retry-1",
        topic: "SEND_BOOKING_VOUCHER_EMAIL",
        payload: { bookingId: "b-err-1" },
        status: "PROCESSING",
        attempts: 1,
        scheduledAt: new Date(),
      };

      const updateSpy = vi.spyOn(prisma.outboxMessage, "update").mockResolvedValue({} as any);

      const ok = await outboxService.processOutboxMessage(mockMessage as any, {
        onNotification: vi.fn().mockRejectedValue(new Error("SMTP connection timed out")),
      });

      expect(ok).toBe(false);
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "msg-retry-1" },
          data: expect.objectContaining({
            status: "PENDING",
            attempts: 2,
            lastError: "SMTP connection timed out",
            lockedAt: null,
            lockedBy: null,
          }),
        }),
      );
    });

    it("marks outbox message as FAILED permanently when max attempts are reached", async () => {
      const mockMessage = {
        id: "msg-fail-1",
        topic: "SEND_BOOKING_VOUCHER_EMAIL",
        payload: { bookingId: "b-err-perm" },
        status: "PROCESSING",
        attempts: 4, // next will be 5, reaching maxAttempts
        scheduledAt: new Date(),
      };

      const updateSpy = vi.spyOn(prisma.outboxMessage, "update").mockResolvedValue({} as any);

      const ok = await outboxService.processOutboxMessage(mockMessage as any, {
        onNotification: vi.fn().mockRejectedValue(new Error("Permanent mail error")),
      });

      expect(ok).toBe(false);
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "msg-fail-1" },
          data: expect.objectContaining({
            status: "FAILED",
            attempts: 5,
            lastError: "Permanent mail error",
          }),
        }),
      );
    });
  });
});
