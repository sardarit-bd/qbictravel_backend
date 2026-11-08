import { prisma } from "../../lib/prisma.js";
import logger from "../../shared/logger/logger.js";
import type { OutboxMessage } from "../../../generated/prisma/client.js";
import type { OutboxTopic } from "../../../generated/prisma/enums.js";
import { createCommissionForBooking } from "../commission/commissionRepository.js";
import * as notificationService from "../notification/notificationService.js";

type PrismaTx = any;

export interface EnqueueOutboxParams {
  topic: OutboxTopic;
  payload: Record<string, any>;
  scheduledAt?: Date;
}

/**
 * Enqueue an Outbox message within an existing Prisma transaction or standalone client.
 */
export const enqueueOutboxMessage = async (
  client: PrismaTx | typeof prisma,
  params: EnqueueOutboxParams,
): Promise<OutboxMessage> => {
  return client.outboxMessage.create({
    data: {
      topic: params.topic,
      payload: params.payload,
      status: "PENDING",
      scheduledAt: params.scheduledAt ?? new Date(),
    },
  });
};

/**
 * Lock and fetch pending outbox messages ready for processing.
 * Concurrency protected with lockedAt and lockedBy.
 */
export const lockPendingOutboxMessages = async (
  workerId: string,
  batchSize = 10,
  lockTimeoutMs = 60000,
): Promise<OutboxMessage[]> => {
  const cutoff = new Date(Date.now() - lockTimeoutMs);

  return prisma.$transaction(async (tx: any) => {
    // Find eligible messages: PENDING or stuck PROCESSING whose lock expired
    const messages = await tx.outboxMessage.findMany({
      where: {
        status: { in: ["PENDING", "PROCESSING"] },
        scheduledAt: { lte: new Date() },
        OR: [
          { lockedAt: null },
          { lockedAt: { lt: cutoff } },
        ],
      },
      take: batchSize,
      orderBy: { createdAt: "asc" },
    });

    if (messages.length === 0) {
      return [];
    }

    const messageIds = messages.map((m: any) => m.id);

    await tx.outboxMessage.updateMany({
      where: { id: { in: messageIds } },
      data: {
        status: "PROCESSING",
        lockedAt: new Date(),
        lockedBy: workerId,
      },
    });

    return messages;
  });
};

/**
 * Process a single outbox message with exponential backoff on retry.
 * Max attempts: 5.
 */
export const processOutboxMessage = async (
  message: OutboxMessage,
  handlers?: {
    onCommission?: (bookingId: string) => Promise<void>;
    onNotification?: (bookingId: string, decision: "CONFIRMED" | "REJECTED") => Promise<void>;
    onReconcile?: (bookingId: string) => Promise<void>;
  },
): Promise<boolean> => {
  const maxAttempts = 5;
  try {
    const payload = message.payload as Record<string, any>;

    switch (message.topic) {
      case "CALCULATE_COMMISSION": {
        const bookingId = payload.bookingId;
        if (!bookingId) {
          throw new Error("Missing bookingId in CALCULATE_COMMISSION payload");
        }
        if (handlers?.onCommission) {
          await handlers.onCommission(bookingId);
        } else {
          await prisma.$transaction(async (tx: any) => {
            await createCommissionForBooking(tx, bookingId);
          });
        }
        break;
      }

      case "SEND_BOOKING_VOUCHER_EMAIL": {
        const bookingId = payload.bookingId;
        const decision = payload.decision || "CONFIRMED";
        if (!bookingId) {
          throw new Error("Missing bookingId in SEND_BOOKING_VOUCHER_EMAIL payload");
        }
        if (handlers?.onNotification) {
          await handlers.onNotification(bookingId, decision);
        } else {
          await notificationService.notifyPaymentDecision(bookingId, decision);
        }
        break;
      }

      case "SEND_ADMIN_PAYMENT_ALERT": {
        logger.info({ payload }, "Outbox: Admin payment alert sent");
        break;
      }

      case "RECONCILE_PAYMENT": {
        const bookingId = payload.bookingId;
        if (handlers?.onReconcile && bookingId) {
          await handlers.onReconcile(bookingId);
        }
        break;
      }

      default:
        logger.warn({ topic: message.topic }, "Unknown outbox topic, marking as completed");
    }

    // Success
    await prisma.outboxMessage.update({
      where: { id: message.id },
      data: {
        status: "COMPLETED",
        processedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
      },
    });

    return true;
  } catch (error: any) {
    const nextAttempts = message.attempts + 1;
    const isPermanentFailure = nextAttempts >= maxAttempts;
    // Exponential backoff: 2^attempts * 10 seconds (10s, 20s, 40s, 80s, 160s)
    const backoffSeconds = Math.pow(2, nextAttempts) * 10;
    const nextScheduledAt = new Date(Date.now() + backoffSeconds * 1000);

    logger.error(
      {
        messageId: message.id,
        topic: message.topic,
        attempts: nextAttempts,
        isPermanentFailure,
        err: error.message,
      },
      "Outbox message processing failed",
    );

    await prisma.outboxMessage.update({
      where: { id: message.id },
      data: {
        status: isPermanentFailure ? "FAILED" : "PENDING",
        attempts: nextAttempts,
        lastError: String(error.message || error),
        scheduledAt: isPermanentFailure ? message.scheduledAt : nextScheduledAt,
        lockedAt: null,
        lockedBy: null,
      },
    });

    return false;
  }
};

/**
 * Worker tick: processes one batch of pending messages.
 */
export const runOutboxWorkerBatch = async (
  workerId = `worker-${process.pid}`,
  batchSize = 10,
  handlers?: Parameters<typeof processOutboxMessage>[1],
): Promise<{ processed: number; succeeded: number; failed: number }> => {
  const messages = await lockPendingOutboxMessages(workerId, batchSize);
  let succeeded = 0;
  let failed = 0;

  for (const message of messages) {
    const ok = await processOutboxMessage(message, handlers);
    if (ok) {
      succeeded++;
    } else {
      failed++;
    }
  }

  return { processed: messages.length, succeeded, failed };
};
