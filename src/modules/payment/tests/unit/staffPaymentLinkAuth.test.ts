import { describe, it, expect, vi, beforeEach } from "vitest";
import * as paymentRepository from "../../paymentRepository.js";
import { generateStaffPaymentLink } from "../../paymentService.js";

vi.mock("../../paymentRepository.js", () => ({
  findBookingForPayment: vi.fn(),
  createOrUpdatePaymentLink: vi.fn(),
}));

describe("generateStaffPaymentLink — Authorization & Eligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(paymentRepository.createOrUpdatePaymentLink).mockResolvedValue({
      id: "pl-1",
      bookingId: "booking-1",
      expiresAt: new Date("2026-12-10T00:00:00Z"),
      status: "ACTIVE",
    } as any);
  });

  const adminCreatedBooking = {
    id: "booking-1",
    createdById: "admin-user-1",
    assignedStaffId: null,
    status: "CONFIRMED",
    paymentStatus: "UNPAID",
    finalPrice: 5900,
    currency: "THB",
    payments: [],
  };

  it("allows authorized Staff to generate a payment link for an Admin-created booking", async () => {
    vi.mocked(paymentRepository.findBookingForPayment).mockResolvedValueOnce(adminCreatedBooking as any);

    const res = await generateStaffPaymentLink({ id: "staff-user-2", role: "staff" }, "booking-1", 7);

    expect(res.bookingId).toBe("booking-1");
    expect(res.remainingBalance).toBe(5900);
    expect(res.paymentUrl).toContain("/pay/");
  });

  it("allows authorized Staff to generate a payment link for another Staff member's booking", async () => {
    vi.mocked(paymentRepository.findBookingForPayment).mockResolvedValueOnce({
      ...adminCreatedBooking,
      createdById: "staff-user-1",
    } as any);

    const res = await generateStaffPaymentLink({ id: "staff-user-2", role: "staff" }, "booking-1", 7);

    expect(res.remainingBalance).toBe(5900);
  });

  it("calculates only the outstanding balance for partially paid bookings", async () => {
    vi.mocked(paymentRepository.findBookingForPayment).mockResolvedValueOnce({
      ...adminCreatedBooking,
      paymentStatus: "PARTIALLY_PAID",
      payments: [{ status: "VERIFIED", amount: 2000 }],
    } as any);

    const res = await generateStaffPaymentLink({ id: "staff-user-2", role: "staff" }, "booking-1", 7);

    expect(res.previouslyPaid).toBe(2000);
    expect(res.remainingBalance).toBe(3900);
  });

  it("rejects fully paid bookings with 409", async () => {
    vi.mocked(paymentRepository.findBookingForPayment).mockResolvedValueOnce({
      ...adminCreatedBooking,
      paymentStatus: "PAID",
      payments: [{ status: "VERIFIED", amount: 5900 }],
    } as any);

    await expect(
      generateStaffPaymentLink({ id: "staff-user-2", role: "staff" }, "booking-1", 7)
    ).rejects.toThrow(/already paid in full/i);
  });

  it("rejects unauthorized roles (customer/agent) with 403", async () => {
    vi.mocked(paymentRepository.findBookingForPayment).mockResolvedValueOnce(adminCreatedBooking as any);

    await expect(
      generateStaffPaymentLink({ id: "customer-1", role: "customer" }, "booking-1", 7)
    ).rejects.toThrow(/not authorized/i);
  });

  it("allows Staff to generate payment link for IN_PROGRESS booking with outstanding balance", async () => {
    vi.mocked(paymentRepository.findBookingForPayment).mockResolvedValueOnce({
      ...adminCreatedBooking,
      status: "IN_PROGRESS",
      paymentStatus: "PARTIALLY_PAID",
      payments: [{ status: "VERIFIED", amount: 1900 }],
    } as any);

    const res = await generateStaffPaymentLink({ id: "staff-user-2", role: "staff" }, "booking-1", 7);

    expect(res.previouslyPaid).toBe(1900);
    expect(res.remainingBalance).toBe(4000);
    expect(res.paymentUrl).toContain("/pay/");
  });

  it("allows PENDING booking with outstanding balance", async () => {
    vi.mocked(paymentRepository.findBookingForPayment).mockResolvedValueOnce({
      ...adminCreatedBooking,
      status: "PENDING",
    } as any);

    const res = await generateStaffPaymentLink({ id: "staff-user-2", role: "staff" }, "booking-1", 7);
    expect(res.remainingBalance).toBe(5900);
  });

  it("rejects CANCELLED and COMPLETED bookings with 409", async () => {
    vi.mocked(paymentRepository.findBookingForPayment).mockResolvedValueOnce({
      ...adminCreatedBooking,
      status: "CANCELLED",
    } as any);

    await expect(
      generateStaffPaymentLink({ id: "staff-user-2", role: "staff" }, "booking-1", 7)
    ).rejects.toThrow(/cancelled/i);

    vi.mocked(paymentRepository.findBookingForPayment).mockResolvedValueOnce({
      ...adminCreatedBooking,
      status: "COMPLETED",
    } as any);

    await expect(
      generateStaffPaymentLink({ id: "staff-user-2", role: "staff" }, "booking-1", 7)
    ).rejects.toThrow(/not eligible for payment/i);
  });
});
