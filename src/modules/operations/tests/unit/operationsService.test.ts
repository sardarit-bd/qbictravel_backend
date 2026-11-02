import { describe, it, expect, vi, beforeEach } from "vitest";
import AppError from "../../../../shared/utils/AppError.js";
import * as operationsRepository from "../../operationsRepository.js";
import * as operationsService from "../../operationsService.js";
vi.mock("../../../notification/notificationService.js");
vi.mock("../../operationsRepository.js");

const repo = vi.mocked(operationsRepository);

const STAFF_ID = "staff-1";
const ADMIN_ID = "admin-1";
const BOOKING_ID = "booking-1";

const makeBooking = (overrides: Record<string, unknown> = {}) =>
  ({
    id: BOOKING_ID,
    status: "CONFIRMED",
    fulfillmentStatus: "NOT_STARTED",
    paymentStatus: "UNPAID",
    assignedStaffId: STAFF_ID,
    ...overrides,
  }) as any;

const expectAppError = async (promise: Promise<unknown>, statusCode: number) => {
  await expect(promise).rejects.toBeInstanceOf(AppError);
  await expect(promise).rejects.toMatchObject({ statusCode });
};

describe("operationsService.updateOperationalStatus", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    repo.findBookingForTransition.mockResolvedValue(makeBooking());
    repo.applyOperationalTransition.mockResolvedValue(makeBooking({ fulfillmentStatus: "IN_PROGRESS" }));
  });

  it("returns 404 for a missing booking", async () => {
    repo.findBookingForTransition.mockResolvedValue(null);
    await expectAppError(
      operationsService.updateOperationalStatus("staff", STAFF_ID, BOOKING_ID, { fulfillmentStatus: "IN_PROGRESS" }),
      404,
    );
  });

  it("returns 404 for a booking assigned to another staff member", async () => {
    repo.findBookingForTransition.mockResolvedValue(makeBooking({ assignedStaffId: "other" }));
    await expectAppError(
      operationsService.updateOperationalStatus("staff", STAFF_ID, BOOKING_ID, { fulfillmentStatus: "IN_PROGRESS" }),
      404,
    );
    expect(repo.applyOperationalTransition).not.toHaveBeenCalled();
  });

  it("returns 409 when the status is unchanged", async () => {
    await expectAppError(
      operationsService.updateOperationalStatus("staff", STAFF_ID, BOOKING_ID, { fulfillmentStatus: "NOT_STARTED" }),
      409,
    );
  });

  it("returns 409 for a transition that does not exist", async () => {
    await expectAppError(
      operationsService.updateOperationalStatus("staff", STAFF_ID, BOOKING_ID, { fulfillmentStatus: "FULFILLED" }),
      409,
    );
  });

  it.each(["PENDING", "AWAITING_APPROVAL", "CANCELLED", "FAILED"])(
    "returns 409 when starting a booking with status %s",
    async (status) => {
      repo.findBookingForTransition.mockResolvedValue(makeBooking({ status }));
      await expectAppError(
        operationsService.updateOperationalStatus("staff", STAFF_ID, BOOKING_ID, { fulfillmentStatus: "IN_PROGRESS" }),
        409,
      );
    },
  );

  it("starts fulfillment and moves the booking to IN_PROGRESS", async () => {
    await operationsService.updateOperationalStatus("staff", STAFF_ID, BOOKING_ID, { fulfillmentStatus: "IN_PROGRESS", notes: "Started" });
    expect(repo.applyOperationalTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "NOT_STARTED",
        to: "IN_PROGRESS",
        bookingFrom: "CONFIRMED",
        bookingTo: "IN_PROGRESS",
        requireAssignedTo: STAFF_ID,
        requirePaid: false,
        action: "OPERATIONS_STATUS_UPDATED",
      }),
    );
  });

  it("does not require payment to start", async () => {
    repo.findBookingForTransition.mockResolvedValue(makeBooking({ paymentStatus: "UNPAID" }));
    await operationsService.updateOperationalStatus("staff", STAFF_ID, BOOKING_ID, { fulfillmentStatus: "IN_PROGRESS" });
    expect(repo.applyOperationalTransition).toHaveBeenCalled();
  });

  it("returns 409 when completing an unpaid booking", async () => {
    repo.findBookingForTransition.mockResolvedValue(
      makeBooking({ status: "IN_PROGRESS", fulfillmentStatus: "IN_PROGRESS", paymentStatus: "UNPAID" }),
    );
    await expectAppError(
      operationsService.updateOperationalStatus("staff", STAFF_ID, BOOKING_ID, { fulfillmentStatus: "FULFILLED" }),
      409,
    );
    expect(repo.applyOperationalTransition).not.toHaveBeenCalled();
  });

  it("completes a paid booking", async () => {
    repo.findBookingForTransition.mockResolvedValue(
      makeBooking({ status: "IN_PROGRESS", fulfillmentStatus: "IN_PROGRESS", paymentStatus: "PAID" }),
    );
    await operationsService.updateOperationalStatus("staff", STAFF_ID, BOOKING_ID, { fulfillmentStatus: "FULFILLED" });
    expect(repo.applyOperationalTransition).toHaveBeenCalledWith(
      expect.objectContaining({ bookingTo: "COMPLETED", requirePaid: true }),
    );
  });

  it("returns 403 when staff try an admin-only correction", async () => {
    repo.findBookingForTransition.mockResolvedValue(
      makeBooking({ status: "IN_PROGRESS", fulfillmentStatus: "IN_PROGRESS" }),
    );
    await expectAppError(
      operationsService.updateOperationalStatus("staff", STAFF_ID, BOOKING_ID, { fulfillmentStatus: "NOT_STARTED" }),
      403,
    );
  });

  it("lets an admin correct a status, with no assignment requirement", async () => {
    repo.findBookingForTransition.mockResolvedValue(
      makeBooking({ status: "COMPLETED", fulfillmentStatus: "FULFILLED", paymentStatus: "PAID", assignedStaffId: null }),
    );
    await operationsService.updateOperationalStatus("admin", ADMIN_ID, BOOKING_ID, {
      fulfillmentStatus: "IN_PROGRESS",
      notes: "Marked complete by mistake",
    });
    expect(repo.applyOperationalTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        actorRole: "admin",
        requireAssignedTo: undefined,
        bookingFrom: "COMPLETED",
        bookingTo: "IN_PROGRESS",
        action: "OPERATIONS_STATUS_CORRECTED",
      }),
    );
  });

  it("returns 409 when the booking changed during the update", async () => {
    repo.applyOperationalTransition.mockResolvedValue(null);
    await expectAppError(
      operationsService.updateOperationalStatus("staff", STAFF_ID, BOOKING_ID, { fulfillmentStatus: "IN_PROGRESS" }),
      409,
    );
  });
});

describe("operationsService.assignBooking", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    repo.findBookingForTransition.mockResolvedValue(makeBooking({ assignedStaffId: null }));
    repo.findActiveStaff.mockResolvedValue({ id: STAFF_ID, name: "Staff" } as any);
    repo.applyAssignment.mockResolvedValue(makeBooking());
  });

  it("returns 404 for a missing booking", async () => {
    repo.findBookingForTransition.mockResolvedValue(null);
    await expectAppError(operationsService.assignBooking(ADMIN_ID, BOOKING_ID, { staffId: STAFF_ID }), 404);
  });

  it("returns 400 for an unknown or inactive staff user", async () => {
    repo.findActiveStaff.mockResolvedValue(null);
    await expectAppError(operationsService.assignBooking(ADMIN_ID, BOOKING_ID, { staffId: "nobody" }), 400);
    expect(repo.applyAssignment).not.toHaveBeenCalled();
  });

  it("assigns a staff member and records the previous one", async () => {
    repo.findBookingForTransition.mockResolvedValue(makeBooking({ assignedStaffId: "old-staff" }));
    await operationsService.assignBooking(ADMIN_ID, BOOKING_ID, { staffId: STAFF_ID, notes: "Handover" });
    expect(repo.applyAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        staffId: STAFF_ID,
        changes: expect.objectContaining({ previousStaffId: "old-staff", newStaffId: STAFF_ID }),
      }),
    );
  });

  it("unassigns without looking up a staff user", async () => {
    await operationsService.assignBooking(ADMIN_ID, BOOKING_ID, { staffId: null });
    expect(repo.findActiveStaff).not.toHaveBeenCalled();
    expect(repo.applyAssignment).toHaveBeenCalledWith(expect.objectContaining({ staffId: null }));
  });

  it("returns 409 when the booking is closed", async () => {
    repo.applyAssignment.mockResolvedValue(null);
    await expectAppError(operationsService.assignBooking(ADMIN_ID, BOOKING_ID, { staffId: STAFF_ID }), 409);
  });
});