import { EventEmitter } from "node:events";
import type { Response } from "express";
import crypto from "node:crypto";
import logger from "../../shared/logger/logger.js";
import type {
  AuthenticatedSSEUser,
  DashboardEventPayload,
  DashboardEventType,
  DashboardEventMetadata,
} from "./eventTypes.js";

interface ConnectedClient {
  id: string;
  user: AuthenticatedSSEUser;
  res: Response;
  connectedAt: Date;
  lastEventIdSent?: string;
}

// Bounded event history ring buffer for Last-Event-ID replay (up to 100 recent events)
const MAX_EVENT_HISTORY = 100;
const HEARTBEAT_INTERVAL_MS = 25000;

class DashboardEventHub extends EventEmitter {
  private clients = new Map<string, ConnectedClient>();
  private eventHistory: DashboardEventPayload[] = [];
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    // Allow high number of listeners across connected SSE clients without warning
    this.setMaxListeners(1000);
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      this.broadcastComment("heartbeat");
    }, HEARTBEAT_INTERVAL_MS);
    // Don't keep the Node.js event loop alive solely for heartbeat interval in tests
    if (this.heartbeatTimer && typeof this.heartbeatTimer.unref === "function") {
      this.heartbeatTimer.unref();
    }
  }

  public registerClient(
    clientId: string,
    user: AuthenticatedSSEUser,
    res: Response,
    lastEventId?: string
  ): void {
    const client: ConnectedClient = {
      id: clientId,
      user,
      res,
      connectedAt: new Date(),
    };

    this.clients.set(clientId, client);
    logger.info(
      { clientId, userId: user.id, role: user.role, activeClients: this.clients.size },
      "SSE Client connected to dashboard events stream"
    );

    // Initial handshake comment
    res.write(`: connected at ${client.connectedAt.toISOString()}\n\n`);

    // If client supplied Last-Event-ID, replay any missed historical events that user is authorized to see
    if (lastEventId) {
      this.replayMissedEvents(client, lastEventId);
    }
  }

  public unregisterClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      this.clients.delete(clientId);
      logger.info(
        { clientId, userId: client.user.id, remainingClients: this.clients.size },
        "SSE Client disconnected and removed"
      );
    }
  }

  public getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Publishes a dashboard event to all eligible connected clients.
   * Filters by user role and ownership rules.
   */
  public publishEvent(
    type: DashboardEventType,
    entityId: string,
    metadata: DashboardEventMetadata = {}
  ): DashboardEventPayload {
    const event: DashboardEventPayload = {
      id: `evt_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      type,
      entityId,
      timestamp: new Date().toISOString(),
      metadata,
    };

    // Keep bounded in-memory event history for Last-Event-ID re-sync
    this.eventHistory.push(event);
    if (this.eventHistory.length > MAX_EVENT_HISTORY) {
      this.eventHistory.shift();
    }

    // Broadcast to authorized connected clients
    for (const [clientId, client] of this.clients.entries()) {
      try {
        if (this.isUserAuthorizedForEvent(client.user, event)) {
          this.sendEventToClient(client, event);
        }
      } catch (err: any) {
        logger.warn(
          { clientId, userId: client.user.id, err: err?.message || err },
          "Failed to write event to SSE client, disconnecting"
        );
        this.unregisterClient(clientId);
      }
    }

    this.emit("event_published", event);
    return event;
  }

  private sendEventToClient(
    client: ConnectedClient,
    event: DashboardEventPayload
  ): void {
    const { res } = client;
    res.write(`id: ${event.id}\n`);
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    client.lastEventIdSent = event.id;
  }

  private broadcastComment(comment: string): void {
    for (const [clientId, client] of this.clients.entries()) {
      try {
        client.res.write(`: ${comment}\n\n`);
      } catch {
        this.unregisterClient(clientId);
      }
    }
  }

  private replayMissedEvents(client: ConnectedClient, lastEventId: string): void {
    const lastIndex = this.eventHistory.findIndex((e) => e.id === lastEventId);
    // If found, replay all subsequent events up to current
    const missed =
      lastIndex >= 0 ? this.eventHistory.slice(lastIndex + 1) : this.eventHistory;

    for (const event of missed) {
      if (this.isUserAuthorizedForEvent(client.user, event)) {
        this.sendEventToClient(client, event);
      }
    }
  }

  /**
   * Phase 7: Strict role-based authorization check.
   * - Admin: Receives all operational, payment, booking, approval, and assignment updates.
   * - Staff: Receives updates for bookings they created, bookings assigned to them, or general operations.
   * - Agent: Receives updates strictly for bookings created by their agency or assigned to their agentId.
   * - Customer: Receives updates strictly for bookings where customerId matches their own user id.
   * - Affiliate: Receives updates only where affiliateId matches.
   */
  public isUserAuthorizedForEvent(
    user: AuthenticatedSSEUser,
    event: DashboardEventPayload
  ): boolean {
    const role = (user.role || "").toLowerCase();
    const meta = event.metadata || {};

    if (role === "admin") {
      return true;
    }

    if (role === "staff") {
      // Staff receives if booking is assigned to them, created by them, or unassigned operational booking
      if (meta.assignedStaffId && meta.assignedStaffId === user.id) return true;
      if (meta.createdById && meta.createdById === user.id) return true;
      // General booking status changes in operations view
      if (
        event.type === "booking.created" ||
        event.type === "booking.status_changed" ||
        event.type === "booking.staff_assigned" ||
        event.type === "booking.completed"
      ) {
        return true;
      }
      return false;
    }

    if (role === "agent") {
      // Agent only sees events for their agency / partner bookings
      return Boolean(meta.agentId && meta.agentId === user.id);
    }

    if (role === "customer") {
      // Customer only sees events for their own personal bookings
      return Boolean(meta.customerId && meta.customerId === user.id);
    }

    if (role === "affiliate") {
      // Affiliate only sees events attributed to their affiliate account
      return Boolean(meta.affiliateId && meta.affiliateId === user.id);
    }

    return false;
  }

  public shutdown(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const [clientId, client] of this.clients.entries()) {
      try {
        client.res.write(`event: shutdown\ndata: {"message":"Server shutting down"}\n\n`);
        client.res.end();
      } catch {
        // ignore write error during shutdown
      }
    }
    this.clients.clear();
  }
}

export const dashboardEventHub = new DashboardEventHub();
