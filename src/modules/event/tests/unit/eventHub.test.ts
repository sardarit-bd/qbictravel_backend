import { describe, it, expect, beforeEach, vi } from "vitest";
import { dashboardEventHub } from "../../eventHub.js";
import type { AuthenticatedSSEUser, DashboardEventPayload } from "../../eventTypes.js";

describe("Dashboard SSE EventHub & Role-Based Authorization", () => {
  beforeEach(() => {
    dashboardEventHub.shutdown();
  });

  it("registers and unregisters SSE clients correctly", () => {
    const mockRes = {
      write: vi.fn(),
      end: vi.fn(),
    } as any;

    const user: AuthenticatedSSEUser = {
      id: "admin-1",
      role: "admin",
    };

    expect(dashboardEventHub.getClientCount()).toBe(0);

    dashboardEventHub.registerClient("client-1", user, mockRes);
    expect(dashboardEventHub.getClientCount()).toBe(1);
    expect(mockRes.write).toHaveBeenCalledWith(expect.stringContaining(": connected at"));

    dashboardEventHub.unregisterClient("client-1");
    expect(dashboardEventHub.getClientCount()).toBe(0);
  });

  it("authorizes Admin users for all dashboard events", () => {
    const adminUser: AuthenticatedSSEUser = { id: "admin-1", role: "admin" };
    const event: DashboardEventPayload = {
      id: "evt_1",
      type: "booking.created",
      entityId: "b-1",
      timestamp: new Date().toISOString(),
      metadata: { customerId: "c-999", agentId: "a-888" },
    };

    expect(dashboardEventHub.isUserAuthorizedForEvent(adminUser, event)).toBe(true);
  });

  it("authorizes Agent users ONLY for their own partner bookings", () => {
    const agentUser: AuthenticatedSSEUser = { id: "agent-123", role: "agent" };

    const matchingEvent: DashboardEventPayload = {
      id: "evt_2",
      type: "booking.created",
      entityId: "b-2",
      timestamp: new Date().toISOString(),
      metadata: { agentId: "agent-123", customerId: "c-1" },
    };

    const foreignEvent: DashboardEventPayload = {
      id: "evt_3",
      type: "booking.created",
      entityId: "b-3",
      timestamp: new Date().toISOString(),
      metadata: { agentId: "agent-other", customerId: "c-2" },
    };

    expect(dashboardEventHub.isUserAuthorizedForEvent(agentUser, matchingEvent)).toBe(true);
    expect(dashboardEventHub.isUserAuthorizedForEvent(agentUser, foreignEvent)).toBe(false);
  });

  it("authorizes Customer users ONLY for their own personal bookings", () => {
    const customerUser: AuthenticatedSSEUser = { id: "cust-456", role: "customer" };

    const matchingEvent: DashboardEventPayload = {
      id: "evt_4",
      type: "booking.status_changed",
      entityId: "b-4",
      timestamp: new Date().toISOString(),
      metadata: { customerId: "cust-456" },
    };

    const foreignEvent: DashboardEventPayload = {
      id: "evt_5",
      type: "booking.status_changed",
      entityId: "b-5",
      timestamp: new Date().toISOString(),
      metadata: { customerId: "cust-other" },
    };

    expect(dashboardEventHub.isUserAuthorizedForEvent(customerUser, matchingEvent)).toBe(true);
    expect(dashboardEventHub.isUserAuthorizedForEvent(customerUser, foreignEvent)).toBe(false);
  });

  it("authorizes Staff users for assigned, created, and operational bookings", () => {
    const staffUser: AuthenticatedSSEUser = { id: "staff-789", role: "staff" };

    const assignedEvent: DashboardEventPayload = {
      id: "evt_6",
      type: "booking.staff_assigned",
      entityId: "b-6",
      timestamp: new Date().toISOString(),
      metadata: { assignedStaffId: "staff-789" },
    };

    const operationalEvent: DashboardEventPayload = {
      id: "evt_7",
      type: "booking.completed",
      entityId: "b-7",
      timestamp: new Date().toISOString(),
      metadata: {},
    };

    const privateAgentPaymentEvent: DashboardEventPayload = {
      id: "evt_8",
      type: "payment.verified",
      entityId: "p-1",
      timestamp: new Date().toISOString(),
      metadata: { agentId: "agent-x", createdById: "agent-x" },
    };

    expect(dashboardEventHub.isUserAuthorizedForEvent(staffUser, assignedEvent)).toBe(true);
    expect(dashboardEventHub.isUserAuthorizedForEvent(staffUser, operationalEvent)).toBe(true);
    expect(dashboardEventHub.isUserAuthorizedForEvent(staffUser, privateAgentPaymentEvent)).toBe(false);
  });

  it("dispatches events with correct SSE format (id, event, data) to connected clients", () => {
    const mockResAdmin = { write: vi.fn(), end: vi.fn() } as any;
    const mockResAgent = { write: vi.fn(), end: vi.fn() } as any;

    const adminUser: AuthenticatedSSEUser = { id: "adm-1", role: "admin" };
    const agentUser: AuthenticatedSSEUser = { id: "agt-1", role: "agent" };

    dashboardEventHub.registerClient("client-admin", adminUser, mockResAdmin);
    dashboardEventHub.registerClient("client-agent", agentUser, mockResAgent);

    // Publish event for agent agt-1
    const event = dashboardEventHub.publishEvent("booking.created", "bkg-101", {
      agentId: "agt-1",
      customerId: "cust-1",
      amount: 500,
    });

    // Both Admin and Agent agt-1 should receive the event
    expect(mockResAdmin.write).toHaveBeenCalledWith(`id: ${event.id}\n`);
    expect(mockResAdmin.write).toHaveBeenCalledWith(`event: booking.created\n`);
    expect(mockResAdmin.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);

    expect(mockResAgent.write).toHaveBeenCalledWith(`id: ${event.id}\n`);
    expect(mockResAgent.write).toHaveBeenCalledWith(`event: booking.created\n`);

    mockResAdmin.write.mockClear();
    mockResAgent.write.mockClear();

    // Publish event for different agent agt-2
    const otherEvent = dashboardEventHub.publishEvent("booking.created", "bkg-102", {
      agentId: "agt-2",
      customerId: "cust-2",
    });

    // Admin receives it, but Agent agt-1 MUST NOT receive it
    expect(mockResAdmin.write).toHaveBeenCalledWith(`id: ${otherEvent.id}\n`);
    expect(mockResAgent.write).not.toHaveBeenCalledWith(`id: ${otherEvent.id}\n`);
  });

  it("replays missed historical events when client supplies Last-Event-ID", () => {
    // Publish 2 events first
    const evt1 = dashboardEventHub.publishEvent("booking.created", "b-1", { customerId: "c-1" });
    const evt2 = dashboardEventHub.publishEvent("booking.created", "b-2", { customerId: "c-1" });

    const mockRes = { write: vi.fn(), end: vi.fn() } as any;
    const adminUser: AuthenticatedSSEUser = { id: "adm-1", role: "admin" };

    // Connect with Last-Event-ID = evt1.id -> should replay evt2
    dashboardEventHub.registerClient("client-recon", adminUser, mockRes, evt1.id);

    expect(mockRes.write).toHaveBeenCalledWith(`id: ${evt2.id}\n`);
    expect(mockRes.write).not.toHaveBeenCalledWith(`id: ${evt1.id}\n`);
  });
});
