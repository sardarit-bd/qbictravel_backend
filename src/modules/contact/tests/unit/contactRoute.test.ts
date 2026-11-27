import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleContactSubmission } from "../../contactRoutes.js";
import * as mailer from "../../../../shared/utils/mailer.js";

vi.mock("../../../../shared/utils/mailer.js", () => ({
  getDynamicTransporter: vi.fn(),
}));

function makeMockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("POST /api/v1/contact — SMTP Contact Submission", () => {
  const origReceiver = process.env.CONTACT_RECEIVER_EMAIL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CONTACT_RECEIVER_EMAIL = "desk@discoverphukettours.com";
  });

  afterEach(() => {
    process.env.CONTACT_RECEIVER_EMAIL = origReceiver;
  });

  it("delivers contact email via SMTP with visitor email as replyTo", async () => {
    const sendMail = vi.fn().mockResolvedValue({
      messageId: "<msg-123@smtp.test>",
      accepted: ["desk@discoverphukettours.com"],
      rejected: [],
    });
    vi.mocked(mailer.getDynamicTransporter).mockResolvedValueOnce({
      transporter: { sendMail } as any,
      fromHeader: '"Discover Phuket Tours" <noreply@discoverphukettours.com>',
      enabled: true,
    });

    const req: any = {
      body: {
        name: "Jane Traveler",
        email: "jane@example.com",
        message: "Hello, I would like to book a private jet ski tour next week.",
      },
    };
    const res = makeMockRes();
    const next = vi.fn();

    await handleContactSubmission(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"Discover Phuket Tours" <noreply@discoverphukettours.com>',
        to: "desk@discoverphukettours.com",
        replyTo: "jane@example.com",
        subject: "New Contact Form Submission — Discover Phuket Tours",
      }),
    );
  });

  it("rejects invalid email with 400", async () => {
    const req: any = {
      body: { name: "Jane", email: "not-an-email", message: "Hello this is a test message." },
    };
    const res = makeMockRes();
    const next = vi.fn();

    await handleContactSubmission(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it("rejects missing required fields with 400", async () => {
    const req: any = { body: { name: "", email: "jane@example.com", message: "" } };
    const res = makeMockRes();
    const next = vi.fn();

    await handleContactSubmission(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it("returns 502 with generic error when SMTP delivery fails", async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error("EAUTH invalid credentials"));
    vi.mocked(mailer.getDynamicTransporter).mockResolvedValueOnce({
      transporter: { sendMail } as any,
      fromHeader: '"Discover Phuket Tours" <noreply@discoverphukettours.com>',
      enabled: true,
    });

    const req: any = {
      body: {
        name: "Jane Traveler",
        email: "jane@example.com",
        message: "Hello, please send me details about ATV tours.",
      },
    };
    const res = makeMockRes();
    const next = vi.fn();

    await handleContactSubmission(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 502,
        message: "Unable to deliver your message right now. Please try again later.",
      }),
    );
  });
});
