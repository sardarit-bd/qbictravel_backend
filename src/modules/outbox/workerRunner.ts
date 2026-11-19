import logger from "../../shared/logger/logger.js";
import { runOutboxWorkerBatch } from "./outboxService.js";

const POLL_INTERVAL_MS = Number(process.env.OUTBOX_POLL_INTERVAL_MS) || 5000;
const BATCH_SIZE = Number(process.env.OUTBOX_BATCH_SIZE) || 10;
const WORKER_ID = `outbox-worker-${process.pid}-${Math.random().toString(36).substring(2, 7)}`;

let isShuttingDown = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const startOutboxWorker = async () => {
  logger.info({ workerId: WORKER_ID, pollIntervalMs: POLL_INTERVAL_MS, batchSize: BATCH_SIZE }, "Outbox worker runner started");

  while (!isShuttingDown) {
    try {
      const result = await runOutboxWorkerBatch(WORKER_ID, BATCH_SIZE);
      if (result.processed > 0) {
        logger.info(
          { workerId: WORKER_ID, ...result },
          "Outbox worker batch processed",
        );
      }
    } catch (err: any) {
      logger.error({ workerId: WORKER_ID, err: err?.message || err }, "Error running outbox worker batch");
    }

    if (!isShuttingDown) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  logger.info({ workerId: WORKER_ID }, "Outbox worker gracefully stopped");
};

// Handle termination signals
const handleShutdown = (signal: string) => {
  logger.info({ workerId: WORKER_ID, signal }, "Shutdown signal received, draining current batch and stopping...");
  isShuttingDown = true;
};

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));

// If run directly via node/tsx
if (import.meta.url === `file://${process.argv[1]}`) {
  startOutboxWorker().catch((err) => {
    logger.fatal({ err: err?.message || err }, "Outbox worker encountered fatal error");
    process.exit(1);
  });
}
