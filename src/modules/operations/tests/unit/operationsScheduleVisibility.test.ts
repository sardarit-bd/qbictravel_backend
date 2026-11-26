import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../../../../lib/prisma.js";
import { queryScheduleBookings } from "../../operationsRepository.js";
import * as operationsService from "../../operationsService.js";

vi.mock("../../../../lib/prisma.js", () => {
  return {
    prisma: {
      booking: {
        findMany: vi.fn(),
      },
    },
  };
});

describe("operationsRepository.queryScheduleBookings authorization policy & staff visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseParams = {
    startDate: new Date("2026-11-25T00:00:00.000Z"),
    endDate: new Date("2026-11-25T23:59:59.999Z"),
  };

  it("1. Admin and Staff both receive query without restricting schedule bookings strictly to logged-in user", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as any);

    // Admin query
    await queryScheduleBookings({
      ...baseParams,
      actorRole: "admin",
      actorId: "admin-uuid-1",
    });

    const adminArgs = vi.mocked(prisma.booking.findMany).mock.calls[0][0];
    const adminWhere = adminArgs?.where as any;

    // Staff query
    await queryScheduleBookings({
      ...baseParams,
      actorRole: "staff",
      actorId: "staff-uuid-123",
    });

    const staffArgs = vi.mocked(prisma.booking.findMany).mock.calls[1][0];
    const staffWhere = staffArgs?.where as any;

    // Verify neither admin nor staff is artificially blocked by assignedStaffId === actorId condition on schedule
    const adminRestricted = adminWhere.AND?.some((c: any) =>
      c.OR?.some((cond: any) => cond.assignedStaffId === "admin-uuid-1")
    );
    const staffRestricted = staffWhere.AND?.some((c: any) =>
      c.OR?.some((cond: any) => cond.assignedStaffId === "staff-uuid-123")
    );

    expect(adminRestricted).toBeFalsy();
    expect(staffRestricted).toBeFalsy();
  });

  it("2 & 3. Booking assigned to logged-in staff OR another staff is operationally visible to staff", async () => {
    const mockBookings = [
      {
        id: "bkg-assigned-me",
        status: "CONFIRMED",
        fulfillmentStatus: "NOT_STARTED",
        paymentStatus: "PAID",
        source: "DIRECT",
        notes: "Travel Date: 2026-11-25 | Departure: 08:00 AM | Guests: 2 Adults",
        createdAt: new Date("2026-11-20T10:00:00Z"),
        assignedStaffId: "staff-logged-in",
        createdById: "staff-other",
        service: {
          id: "srv-phi-phi",
          name: "Phi Phi Island Tour",
          type: "TOUR",
          metadata: {},
          availability: [{ id: "a1", date: new Date("2026-11-25T00:00:00Z"), capacity: 20, bookedCount: 5 }],
        },
        availability: { id: "a1", date: new Date("2026-11-25T00:00:00Z"), capacity: 20, bookedCount: 5 },
        customer: { id: "c1", name: "Guest One", email: "one@example.com", phone: "+66810001111" },
        assignedStaff: { id: "staff-logged-in", name: "Staff Logged In" },
      },
      {
        id: "bkg-assigned-other",
        status: "CONFIRMED",
        fulfillmentStatus: "IN_PROGRESS",
        paymentStatus: "PAID",
        source: "AGENT",
        notes: "Travel Date: 2026-11-25 | Departure: 08:00 AM | Guests: 3 Adults",
        createdAt: new Date("2026-11-20T11:00:00Z"),
        assignedStaffId: "staff-other-member",
        createdById: "agent-user",
        service: {
          id: "srv-phi-phi",
          name: "Phi Phi Island Tour",
          type: "TOUR",
          metadata: {},
          availability: [{ id: "a1", date: new Date("2026-11-25T00:00:00Z"), capacity: 20, bookedCount: 5 }],
        },
        availability: { id: "a1", date: new Date("2026-11-25T00:00:00Z"), capacity: 20, bookedCount: 5 },
        customer: { id: "c2", name: "Guest Two", email: "two@example.com", phone: "+66810002222" },
        assignedStaff: { id: "staff-other-member", name: "Other Staff" },
      },
    ];

    vi.mocked(prisma.booking.findMany).mockResolvedValue(mockBookings as any);

    const result = await operationsService.getOperationsSchedule("staff", "staff-logged-in", {
      startDate: "2026-11-25",
      endDate: "2026-11-25",
    });

    expect(result.totalBookings).toBe(2);
    expect(result.totalPassengers).toBe(5);
    expect(result.groups.length).toBe(1);
    expect(result.groups[0].bookings.map((b) => b.id)).toEqual(["bkg-assigned-me", "bkg-assigned-other"]);
  });

  it("4 & 5. Customer-created direct booking and Agent-created booking are visible in schedule for operational fulfillment", async () => {
    const mockBookings = [
      {
        id: "bkg-direct-cust",
        status: "CONFIRMED",
        fulfillmentStatus: "NOT_STARTED",
        paymentStatus: "PAID",
        source: "CUSTOMER",
        notes: "Travel Date: 2026-11-25 | Departure: 09:00 AM | Guests: 1 Adult",
        createdAt: new Date("2026-11-21T10:00:00Z"),
        assignedStaffId: null,
        createdById: "customer-uuid",
        service: {
          id: "srv-jetski",
          name: "Jet Ski Coastal Tour",
          type: "TOUR",
          metadata: {},
          availability: [{ id: "a2", date: new Date("2026-11-25T00:00:00Z"), capacity: 10, bookedCount: 1 }],
        },
        availability: { id: "a2", date: new Date("2026-11-25T00:00:00Z"), capacity: 10, bookedCount: 1 },
        customer: { id: "c3", name: "Direct Customer", email: "direct@example.com", phone: "+66810003333" },
        assignedStaff: null,
      },
      {
        id: "bkg-agent",
        status: "CONFIRMED",
        fulfillmentStatus: "NOT_STARTED",
        paymentStatus: "PAID",
        source: "AGENT",
        notes: "Travel Date: 2026-11-25 | Departure: 09:00 AM | Guests: 2 Adults",
        createdAt: new Date("2026-11-21T11:00:00Z"),
        assignedStaffId: null,
        createdById: "agent-uuid",
        service: {
          id: "srv-jetski",
          name: "Jet Ski Coastal Tour",
          type: "TOUR",
          metadata: {},
          availability: [{ id: "a2", date: new Date("2026-11-25T00:00:00Z"), capacity: 10, bookedCount: 3 }],
        },
        availability: { id: "a2", date: new Date("2026-11-25T00:00:00Z"), capacity: 10, bookedCount: 3 },
        customer: { id: "c4", name: "Agent Guest", email: "agentguest@example.com", phone: "+66810004444" },
        assignedStaff: null,
      },
    ];

    vi.mocked(prisma.booking.findMany).mockResolvedValue(mockBookings as any);

    const result = await operationsService.getOperationsSchedule("staff", "staff-logged-in", {
      startDate: "2026-11-25",
      endDate: "2026-11-25",
    });

    expect(result.totalBookings).toBe(2);
    expect(result.totalPassengers).toBe(3);
    expect(result.groups.length).toBe(1);
    expect(result.groups[0].bookings.some((b) => b.source === "CUSTOMER")).toBe(true);
    expect(result.groups[0].bookings.some((b) => b.source === "AGENT")).toBe(true);
  });

  it("6. Different booking statuses (CONFIRMED, IN_PROGRESS, COMPLETED, PENDING) are supported", async () => {
    const mockBookings = [
      {
        id: "bkg-confirmed",
        status: "CONFIRMED",
        fulfillmentStatus: "NOT_STARTED",
        paymentStatus: "PAID",
        source: "DIRECT",
        notes: "Travel Date: 2026-11-25 | Departure: 10:00 AM | Guests: 1 Adult",
        createdAt: new Date("2026-11-22T08:00:00Z"),
        service: { id: "srv-1", name: "Tour A", type: "TOUR", metadata: {}, availability: [] },
        availability: { id: "a1", date: new Date("2026-11-25T00:00:00Z"), capacity: 10, bookedCount: 1 },
        customer: { id: "c1", name: "Guest Confirmed", email: "conf@example.com", phone: null },
        assignedStaff: null,
      },
      {
        id: "bkg-in-progress",
        status: "IN_PROGRESS",
        fulfillmentStatus: "IN_PROGRESS",
        paymentStatus: "PAID",
        source: "DIRECT",
        notes: "Travel Date: 2026-11-25 | Departure: 10:00 AM | Guests: 1 Adult",
        createdAt: new Date("2026-11-22T08:30:00Z"),
        service: { id: "srv-1", name: "Tour A", type: "TOUR", metadata: {}, availability: [] },
        availability: { id: "a1", date: new Date("2026-11-25T00:00:00Z"), capacity: 10, bookedCount: 2 },
        customer: { id: "c2", name: "Guest InProgress", email: "prog@example.com", phone: null },
        assignedStaff: null,
      },
      {
        id: "bkg-completed",
        status: "COMPLETED",
        fulfillmentStatus: "FULFILLED",
        paymentStatus: "PAID",
        source: "DIRECT",
        notes: "Travel Date: 2026-11-25 | Departure: 10:00 AM | Guests: 1 Adult",
        createdAt: new Date("2026-11-22T09:00:00Z"),
        service: { id: "srv-1", name: "Tour A", type: "TOUR", metadata: {}, availability: [] },
        availability: { id: "a1", date: new Date("2026-11-25T00:00:00Z"), capacity: 10, bookedCount: 3 },
        customer: { id: "c3", name: "Guest Completed", email: "comp@example.com", phone: null },
        assignedStaff: null,
      },
      {
        id: "bkg-pending",
        status: "PENDING",
        fulfillmentStatus: "NOT_STARTED",
        paymentStatus: "UNPAID",
        source: "DIRECT",
        notes: "Travel Date: 2026-11-25 | Departure: 10:00 AM | Guests: 1 Adult",
        createdAt: new Date("2026-11-22T09:30:00Z"),
        service: { id: "srv-1", name: "Tour A", type: "TOUR", metadata: {}, availability: [] },
        availability: { id: "a1", date: new Date("2026-11-25T00:00:00Z"), capacity: 10, bookedCount: 4 },
        customer: { id: "c4", name: "Guest Pending", email: "pend@example.com", phone: null },
        assignedStaff: null,
      },
    ];

    vi.mocked(prisma.booking.findMany).mockResolvedValue(mockBookings as any);

    const result = await operationsService.getOperationsSchedule("staff", "staff-logged-in", {
      startDate: "2026-11-25",
      endDate: "2026-11-25",
    });

    expect(result.totalBookings).toBe(4);
    expect(result.totalPassengers).toBe(4);
  });

  it("7. Correctly handles bookings around midnight and Thailand (Asia/Bangkok) timezone boundaries", async () => {
    // 01:00 AM on Nov 25 in Thailand (UTC+7) is 18:00 (6:00 PM) on Nov 24 in UTC
    const bookingEarlyMorningBkk = {
      id: "bkg-early-morning",
      status: "CONFIRMED",
      fulfillmentStatus: "NOT_STARTED",
      paymentStatus: "PAID",
      source: "DIRECT",
      notes: "Travel Date: 2026-11-25 | Departure: 06:30 AM | Guests: 2 Adults",
      createdAt: new Date("2026-11-24T18:30:00.000Z"), // Nov 25 01:30 AM in Thailand
      service: { id: "srv-early", name: "Early Bird Tour", type: "TOUR", metadata: {}, availability: [] },
      availability: null, // Unlinked availability; fallback resolves to createdAt in Thailand timezone
      customer: { id: "c-early", name: "Early Bird Customer", email: "early@example.com", phone: null },
      assignedStaff: null,
    };

    vi.mocked(prisma.booking.findMany).mockResolvedValue([bookingEarlyMorningBkk] as any);

    const result = await operationsService.getOperationsSchedule("staff", "staff-1", {
      startDate: "2026-11-25",
      endDate: "2026-11-25",
    });

    expect(result.totalBookings).toBe(1);
    expect(result.groups[0].travelDate).toBe("2026-11-25");
  });

  it("8. Date with no bookings returns 0 tours, 0 bookings, 0 passengers without error", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([] as any);

    const result = await operationsService.getOperationsSchedule("staff", "staff-1", {
      startDate: "2026-11-26",
      endDate: "2026-11-26",
    });

    expect(result.totalGroups).toBe(0);
    expect(result.totalBookings).toBe(0);
    expect(result.totalPassengers).toBe(0);
    expect(result.groups).toEqual([]);
  });

  it("9. Calculates correct tour, booking, and guest aggregates", async () => {
    const mockBookings = [
      {
        id: "bkg-1",
        status: "CONFIRMED",
        fulfillmentStatus: "NOT_STARTED",
        paymentStatus: "PAID",
        source: "DIRECT",
        notes: "Travel Date: 2026-11-25 | Departure: 08:00 AM | Guests: 2 Adults, 1 Child",
        createdAt: new Date("2026-11-20T10:00:00Z"),
        service: { id: "srv-tour-1", name: "Tour One", type: "TOUR", metadata: {}, availability: [] },
        availability: { id: "a1", date: new Date("2026-11-25T00:00:00Z"), capacity: 20, bookedCount: 3 },
        customer: { id: "c1", name: "Guest 1", email: null, phone: null },
        assignedStaff: null,
      },
      {
        id: "bkg-2",
        status: "CONFIRMED",
        fulfillmentStatus: "IN_PROGRESS",
        paymentStatus: "PAID",
        source: "DIRECT",
        notes: "Travel Date: 2026-11-25 | Departure: 08:00 AM | Guests: 1 Adult, 1 Infant",
        createdAt: new Date("2026-11-20T11:00:00Z"),
        service: { id: "srv-tour-1", name: "Tour One", type: "TOUR", metadata: {}, availability: [] },
        availability: { id: "a1", date: new Date("2026-11-25T00:00:00Z"), capacity: 20, bookedCount: 5 },
        customer: { id: "c2", name: "Guest 2", email: null, phone: null },
        assignedStaff: null,
      },
    ];

    vi.mocked(prisma.booking.findMany).mockResolvedValue(mockBookings as any);

    const result = await operationsService.getOperationsSchedule("staff", "staff-1", {
      startDate: "2026-11-25",
      endDate: "2026-11-25",
    });

    expect(result.totalGroups).toBe(1);
    expect(result.totalBookings).toBe(2);
    expect(result.totalPassengers).toBe(5); // (2+1) + (1+1)
    expect(result.groups[0].totalAdults).toBe(3);
    expect(result.groups[0].totalChildren).toBe(1);
    expect(result.groups[0].totalInfants).toBe(1);
  });
});
