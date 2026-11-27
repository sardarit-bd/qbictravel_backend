import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { getDynamicTransporter } from "../../shared/utils/mailer.js";
import logger from "../../shared/logger/logger.js";
import AppError from "../../shared/utils/AppError.js";

const router = Router();

const contactRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many contact requests. Please wait a few minutes and try again.",
  },
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const handleContactSubmission = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const rawName = typeof req.body?.name === "string" ? sanitizeHeaderValue(req.body.name) : "";
    const rawEmail = typeof req.body?.email === "string" ? sanitizeHeaderValue(req.body.email) : "";
    const rawPhone = typeof req.body?.phone === "string" ? sanitizeHeaderValue(req.body.phone) : "";
    const rawMessage = typeof req.body?.message === "string" ? req.body.message.trim() : "";

    if (!rawName || rawName.length < 2 || rawName.length > 120) {
      throw new AppError("Please provide your name (2 to 120 characters).", 400);
    }
    if (!rawEmail || !EMAIL_REGEX.test(rawEmail) || rawEmail.length > 254) {
      throw new AppError("Please provide a valid email address.", 400);
    }
    if (!rawMessage || rawMessage.length < 10 || rawMessage.length > 5000) {
      throw new AppError("Please provide a message (10 to 5000 characters).", 400);
    }

    const receiverEmail = (process.env.CONTACT_RECEIVER_EMAIL || "").trim();
    if (!receiverEmail || !EMAIL_REGEX.test(receiverEmail)) {
      logger.error("Contact form delivery aborted: CONTACT_RECEIVER_EMAIL is not configured");
      throw new AppError("Contact email service is currently unavailable. Please try again later.", 503);
    }

    const { transporter, fromHeader, enabled } = await getDynamicTransporter();
    if (!enabled || !transporter) {
      logger.error("Contact form delivery aborted: SMTP is not configured");
      throw new AppError("Contact email service is currently unavailable. Please try again later.", 503);
    }

    const submittedAt = new Date().toISOString();
    const subject = "New Contact Form Submission — Discover Phuket Tours";

    const textLines = [
      "New Contact Form Submission — Discover Phuket Tours",
      `Submitted: ${submittedAt}`,
      `Name: ${rawName}`,
      `Email: ${rawEmail}`,
      ...(rawPhone ? [`Phone: ${rawPhone}`] : []),
      "",
      "Message:",
      rawMessage,
    ];

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #18282A; border: 1px solid #E5EAED; border-radius: 12px; overflow: hidden;">
        <div style="background: #176779; color: #ffffff; padding: 20px 24px;">
          <h2 style="margin: 0; font-size: 18px;">New Contact Form Submission — Discover Phuket Tours</h2>
        </div>
        <div style="padding: 24px; background: #ffffff; line-height: 1.6; font-size: 14px;">
          <p style="margin: 0 0 8px;"><strong>Name:</strong> ${escapeHtml(rawName)}</p>
          <p style="margin: 0 0 8px;"><strong>Email:</strong> ${escapeHtml(rawEmail)}</p>
          ${rawPhone ? `<p style="margin: 0 0 8px;"><strong>Phone:</strong> ${escapeHtml(rawPhone)}</p>` : ""}
          <p style="margin: 0 0 16px;"><strong>Submitted At:</strong> ${escapeHtml(submittedAt)}</p>
          <div style="border-top: 1px solid #EEF2F3; padding-top: 16px;">
            <p style="margin: 0 0 8px;"><strong>Message:</strong></p>
            <p style="margin: 0; white-space: pre-wrap;">${escapeHtml(rawMessage)}</p>
          </div>
        </div>
      </div>
    `;

    try {
      const info = await transporter.sendMail({
        from: fromHeader,
        to: receiverEmail,
        replyTo: rawEmail,
        subject,
        text: textLines.join("\n"),
        html,
      });

      const accepted = Array.isArray(info.accepted) ? info.accepted : [];
      const rejected = Array.isArray(info.rejected) ? info.rejected : [];
      if (rejected.length > 0 && accepted.length === 0) {
        logger.error({ to: receiverEmail, rejectedCount: rejected.length }, "Contact email rejected by SMTP server");
        throw new AppError("Unable to deliver your message right now. Please try again later.", 502);
      }

      logger.info({ messageId: info.messageId, to: receiverEmail }, "Contact form email delivered via SMTP");
      return res.status(200).json({
        success: true,
        message: "Your message has been sent successfully.",
      });
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      logger.error(
        { errCode: err?.code, errResponseCode: err?.responseCode },
        "SMTP delivery failed for contact form submission",
      );
      throw new AppError("Unable to deliver your message right now. Please try again later.", 502);
    }
  } catch (error) {
    return next(error);
  }
};

router.post("/", contactRateLimiter, handleContactSubmission);

export default router;
