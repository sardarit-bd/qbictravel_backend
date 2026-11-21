import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { dashboardEventHub } from "./eventHub.js";
import logger from "../../shared/logger/logger.js";
import type { AuthenticatedSSEUser } from "./eventTypes.js";

/**
 * GET /api/v1/events/stream
 * Authenticated Server-Sent Events stream endpoint for live dashboard updates.
 *
 * Headers set:
 * - Content-Type: text/event-stream
 * - Cache-Control: no-cache, no-transform
 * - Connection: keep-alive
 * - X-Accel-Buffering: no (disables reverse proxy response buffering)
 */
export const streamDashboardEvents = async (
  req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> => {
  // Ensure user is authenticated via authMiddleware
  const user = req.user as AuthenticatedSSEUser | undefined;
  if (!user || !user.id) {
    res.status(401).json({ success: false, message: "Unauthorized, session required" });
    return;
  }

  // Set SSE response headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Flush headers immediately if response object supports it
  if (typeof (res as any).flushHeaders === "function") {
    (res as any).flushHeaders();
  }

  const clientId = `sse_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const lastEventId = (req.headers["last-event-id"] as string | undefined) || (req.query.lastEventId as string | undefined);

  dashboardEventHub.registerClient(clientId, user, res, lastEventId);

  // Clean up client when request connection closes
  req.on("close", () => {
    dashboardEventHub.unregisterClient(clientId);
  });
};
