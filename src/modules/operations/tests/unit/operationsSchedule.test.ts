import { describe, it, expect, vi, beforeEach } from "vitest";
import * as operationsRepository from "../../operationsRepository.js";
import * as operationsService from "../../operationsService.js";

vi.mock("../../operationsRepository.js");
vi.mock("../notification/notificationService.js", () => ({
  notifyOperationalUpdate: vi.fn().mockResolvedValue(undefined),
  notifyStaffAssignment: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../event/eventEmitter.js", () => ({
  emitBookingEvent: vi.fn().mockResolvedValue(undefined),
}));

describe("operationsService.getOperationsSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts travel date, departure time, passengers and pickup location properly into groups", async () => {
    const mockBookings = [
      {
        id: "bkg-11111111-1111-1111-1111-111111111111",
        status: "CONFIRMED",
        fulfillmentStatus: "NOT_STARTED",
        paymentStatus: "PAID",
        source: "DIRECT",
        notes: "Travel Date: 2026-12-01 | Departure: 08:30 AM | Guests: 2 Adults, 1 Child | Pickup: Katathani Beach Resort | Special requests: vegetarian lunch",
        internalNotes: null,
        createdAt: new Date("2026-11-20T10:00:00Z"),
        service: {
          id: "srv-phi-phi",
          name: "Phi Phi Island Luxury Catamaran",
          type: "TOUR",
          metadata: {},
          availability: [
            {
              id: "avail-1",
              date: new Date("2026-12-01T00:00:00Z"),
              capacity: 30,
              bookedCount: 15,
            },
          ],
        },
        availability: {
          id: "avail-1",
          date: new Date("2026-12-01T00:00:00Z"),
          capacity: 30,
          bookedCount: 15,
        },
        customer: {
          id: "cust-1",
          name: "Alice Smith",
          email: "alice@example.com",
          phone: "+66 89 123 4567",
        },
        assignedStaff: {
          id: "staff-1",
          name: "Somchai Staff",
        },
      },
      {
        id: "bkg-22222222-2222-2222-2222-222222222222",
        status: "CONFIRMED",
        fulfillmentStatus: "IN_PROGRESS",
        paymentStatus: "PAID",
        source: "AGENT",
        notes: "Travel Date: 2026-12-01 | Departure: 08:30 AM | Guests: 1 Adult | Pickup: Patong Merlin Hotel",
        internalNotes: null,
        createdAt: new Date("2026-11-20T11:00:00Z"),
        service: {
          id: "srv-phi-phi",
          name: "Phi Phi Island Luxury Catamaran",
          type: "TOUR",
          metadata: {},
          availability: [
            {
              id: "avail-1",
              date: new Date("2026-12-01T00:00:00Z"),
              capacity: 30,
              bookedCount: 15,
            },
          ],
        },
        availability: {
          id: "avail-1",
          date: new Date("2026-12-01T00:00:00Z"),
          capacity: 30,
          bookedCount: 15,
        },
        customer: {
          id: "cust-2",
          name: "Bob Jones",
          email: "bob@example.com",
          phone: "+66 81 987 6543",
        },
        assignedStaff: null,
      },
      {
        id: "bkg-33333333-3333-3333-3333-333333333333",
        status: "CONFIRMED",
        fulfillmentStatus: "NOT_STARTED",
        paymentStatus: "UNPAID",
        source: "STAFF",
        // Note without departure time
        notes: "Travel Date: 2026-12-01 | Guests: 2 Adults | Pickup: Marriott Resort",
        internalNotes: null,
        createdAt: new Date("2026-11-20T12:00:00Z"),
        service: {
          id: "srv-similan",
          name: "Similan Islands Early Bird",
          type: "TOUR",
          metadata: {},
          availability: [],
        },
        availability: null,
        customer: {
          id: "cust-3",
          name: "Charlie Brown",
          email: "charlie@example.com",
          phone: "+66 82 555 4444",
        },
        assignedStaff: null,
      },
    ];

    vi.mocked(operationsRepository.queryScheduleBookings).mockResolvedValue(mockBookings as any);

    const result = await operationsService.getOperationsSchedule("staff", "staff-1", {
      startDate: "2026-12-01",
      endDate: "2026-12-01",
    });

    expect(result.startDate).toBe("2026-12-01");
    expect(result.endDate).toBe("2026-12-01");
    expect(result.totalBookings).toBe(3);
    expect(result.totalPassengers).toBe(6); // 3 (Alice) + 1 (Bob) + 2 (Charlie)
    expect(result.groups.length).toBe(2); // Group 1: Phi Phi @ 08:30 AM, Group 2: Similan (unscheduled)

    // Verify Group 1: Phi Phi Island
    const phiPhiGroup = result.groups.find((g) => g.serviceId === "srv-phi-phi")!;
    expect(phiPhiGroup).toBeDefined();
    expect(phiPhiGroup.travelDate).toBe("2026-12-01");
    expect(phiPhiGroup.departureTime).toBe("08:30 AM");
    expect(phiPhiGroup.hasDepartureTime).toBe(true);
    expect(phiPhiGroup.totalBookings).toBe(2);
    expect(phiPhiGroup.totalPassengers).toBe(4);
    expect(phiPhiGroup.totalAdults).toBe(3);
    expect(phiPhiGroup.totalChildren).toBe(1);
    expect(phiPhiGroup.capacity?.total).toBe(30);
    expect(phiPhiGroup.capacity?.bookedCount).toBe(15);
    expect(phiPhiGroup.capacity?.remaining).toBe(15);
    expect(phiPhiGroup.pickupSummary.locationsCount).toBe(2);
    expect(phiPhiGroup.pickupSummary.locations).toContain("Katathani Beach Resort");
    expect(phiPhiGroup.pickupSummary.locations).toContain("Patong Merlin Hotel");

    // Check special instructions in Alice's booking
    const aliceBooking = phiPhiGroup.bookings.find((b) => b.customerName === "Alice Smith")!;
    expect(aliceBooking.specialInstructions).toBe("vegetarian lunch");

    // Verify Group 2: Similan Islands without departure time
    const similanGroup = result.groups.find((g) => g.serviceId === "srv-similan")!;
    expect(similanGroup).toBeDefined();
    expect(similanGroup.departureTime).toBeNull();
    expect(similanGroup.hasDepartureTime).toBe(false);
    expect(similanGroup.capacity).toBeNull(); // No capacity configured
    expect(similanGroup.bookings[0].departureTime).toBeNull();
    expect(similanGroup.bookings[0].hasDepartureTime).toBe(false);
  });
});
