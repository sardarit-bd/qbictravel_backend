import { describe, it, expect, vi, beforeEach } from "vitest";
import * as notificationRepository from "../../notificationRepository.js";
import * as notificationService from "../../notificationService.js";
import { sendEmail } from "../../../../shared/utils/mailer.js";
import logger from "../../../../shared/logger/logger.js";

vi.mock("../../notificationRepository.js");
vi.mock("../../../../shared/utils/mailer.js");
vi.mock("../../../../shared/logger/logger.js", () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const repo = vi.mocked(notificationRepository);
const send = vi.mocked(sendEmail);

const makeBooking = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "booking-1",
    status: "CONFIRMED",
    paymentStatus: "UNPAID",
    fulfillmentStatus: "NOT_STARTED",
    service: { name: "Desert Safari" },
    customer: { name: "Sara", email: "sara@example.com", status: "active" },
    agent: { name: "Omar", email: "omar@example.com", status: "active" },
    ...overrides,
  }) as any;

describe("notificationService settings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns every event as enabled when nothing is stored", async () => {
    repo.listSettings.mockResolvedValue([]);
    const result = await notificationService.getSettings();
    expect(result.settings).toHaveLength(4);
    expect(result.settings.every((s) => s.enabled)).toBe(true);
  });

  it("returns a stored disabled value", async () => {
    repo.listSettings.mockResolvedValue([
      { event: "PAYMENT_CONFIRMATION", enabled: false, updatedAt: new Date() },
    ] as any);
    const result = await notificationService.getSettings();
    expect(result.settings.find((s) => s.event === "PAYMENT_CONFIRMATION")?.enabled).toBe(false);
  });

  it("upserts with the admin id and returns the merged settings", async () => {
    repo.upsertSettings.mockResolvedValue([] as any);
    repo.listSettings.mockResolvedValue([]);
    const result = await notificationService.updateSettings("admin-1", {
      settings: [{ event: "BOOKING_CONFIRMATION", enabled: false }],
    });
    expect(repo.upsertSettings).toHaveBeenCalledWith(
      [{ event: "BOOKING_CONFIRMATION", enabled: false }],
      "admin-1",
    );
    expect(result.settings).toHaveLength(4);
  });
});

describe("notificationService booking notifications", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    repo.findSetting.mockResolvedValue(null);
    repo.findBookingRecipients.mockResolvedValue(makeBooking());
    send.mockResolvedValue(undefined);
  });

  it("emails the customer and the agent when no setting is stored", async () => {
    await notificationService.notifyBookingCreated("booking-1");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "sara@example.com" }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "omar@example.com" }));
  });

  it("sends nothing when the event is disabled", async () => {
    repo.findSetting.mockResolvedValue({ enabled: false } as any);
    await notificationService.notifyBookingStatusChanged("booking-1");
    expect(send).not.toHaveBeenCalled();
    expect(repo.findBookingRecipients).not.toHaveBeenCalled();
  });

  it("emails only the customer when the booking has no agent", async () => {
    repo.findBookingRecipients.mockResolvedValue(makeBooking({ agent: null }));
    await notificationService.notifyOperationalUpdate("booking-1");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("skips deactivated recipients", async () => {
    repo.findBookingRecipients.mockResolvedValue(
      makeBooking({ agent: { name: "Omar", email: "omar@example.com", status: "deactivated" } }),
    );
    await notificationService.notifyBookingCreated("booking-1");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "sara@example.com" }));
  });

  it("does nothing when the booking is not found", async () => {
    repo.findBookingRecipients.mockResolvedValue(null);
    await notificationService.notifyBookingCreated("booking-1");
    expect(send).not.toHaveBeenCalled();
  });

  it("uses a different subject for a rejected payment", async () => {
    await notificationService.notifyPaymentDecision("booking-1", "REJECTED");
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Your payment could not be verified" }),
    );
  });

  it("never throws when sending fails, and logs the error", async () => {
    send.mockRejectedValue(new Error("smtp down"));
    await expect(notificationService.notifyBookingCreated("booking-1")).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it("never throws when the database lookup fails", async () => {
    repo.findBookingRecipients.mockRejectedValue(new Error("db down"));
    await expect(notificationService.notifyBookingCreated("booking-1")).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});