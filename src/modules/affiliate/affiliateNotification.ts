import { sendEmail } from "../../shared/utils/mailer.js";
import logger from "../../shared/logger/logger.js";

function getAdminAlertEmail(): string | null {
  return process.env.ADMIN_NOTIFICATION_EMAIL || process.env.SMTP_USER || null;
}

async function safeSend(to: string | null | undefined, subject: string, html: string) {
  if (!to) return;
  try {
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    await sendEmail({ to, subject, text, html });
  } catch (err) {
    logger.warn({ err, to, subject }, "Affiliate notification email failed (non-blocking)");
  }
}

export const affiliateNotification = {
  async notifyAdminNewApplication(params: { applicantName: string; applicantEmail: string; code: string }) {
    await safeSend(
      getAdminAlertEmail(),
      `New Affiliate Application — ${params.applicantName}`,
      `<p>A new affiliate application has been submitted.</p>
       <ul>
         <li><strong>Name:</strong> ${params.applicantName}</li>
         <li><strong>Email:</strong> ${params.applicantEmail}</li>
         <li><strong>Code:</strong> ${params.code}</li>
       </ul>`
    );
  },

  async notifyAffiliateApplicationApproved(params: { email: string; name: string; code: string }) {
    await safeSend(
      params.email,
      "Your PhuketTours Affiliate Application is Approved!",
      `<p>Hi ${params.name},</p>
       <p>Congratulations! Your affiliate application has been approved.</p>
       <p>Your unique referral code is: <strong>${params.code}</strong></p>
       <p>You can now log in to your Affiliate Dashboard to generate referral links and track commissions.</p>`
    );
  },

  async notifyAffiliateApplicationRejected(params: { email: string; name: string; reason: string }) {
    await safeSend(
      params.email,
      "Update on Your PhuketTours Affiliate Application",
      `<p>Hi ${params.name},</p>
       <p>Thank you for applying to the PhuketTours Affiliate Program. Unfortunately, your application was not approved at this time.</p>
       <p><strong>Reason:</strong> ${params.reason}</p>`
    );
  },

  async notifyAffiliateCommissionEarned(params: {
    email: string;
    name: string;
    bookingId: string;
    amount: number;
    currency: string;
    rate: number;
  }) {
    await safeSend(
      params.email,
      `New Affiliate Commission Earned: ${params.currency} ${params.amount.toFixed(2)}`,
      `<p>Hi ${params.name},</p>
       <p>You earned a new commission of <strong>${params.currency} ${params.amount.toFixed(2)}</strong> (${params.rate}%) for booking <code>${params.bookingId}</code>.</p>`
    );
  },

  async notifyPayoutRequested(params: {
    affiliateEmail: string;
    affiliateName: string;
    amount: number;
    currency: string;
    payoutId: string;
  }) {
    await Promise.all([
      safeSend(
        params.affiliateEmail,
        `Payout Request Received — ${params.currency} ${params.amount.toFixed(2)}`,
        `<p>Hi ${params.affiliateName},</p>
         <p>Your payout request (<code>${params.payoutId}</code>) for <strong>${params.currency} ${params.amount.toFixed(2)}</strong> has been submitted and is pending Admin review.</p>`
      ),
      safeSend(
        getAdminAlertEmail(),
        `New Affiliate Payout Request — ${params.currency} ${params.amount.toFixed(2)}`,
        `<p><strong>${params.affiliateName}</strong> (${params.affiliateEmail}) requested a payout of <strong>${params.currency} ${params.amount.toFixed(2)}</strong> (ID: <code>${params.payoutId}</code>).</p>`
      ),
    ]);
  },

  async notifyPayoutApproved(params: { email: string; name: string; amount: number; currency: string; payoutId: string }) {
    await safeSend(
      params.email,
      `Payout Request Approved — ${params.currency} ${params.amount.toFixed(2)}`,
      `<p>Hi ${params.name},</p>
       <p>Your payout request (<code>${params.payoutId}</code>) for <strong>${params.currency} ${params.amount.toFixed(2)}</strong> has been approved and will be sent manually by our team.</p>`
    );
  },

  async notifyPayoutRejected(params: {
    email: string;
    name: string;
    amount: number;
    currency: string;
    payoutId: string;
    reason: string;
  }) {
    await safeSend(
      params.email,
      `Payout Request Rejected — ${params.currency} ${params.amount.toFixed(2)}`,
      `<p>Hi ${params.name},</p>
       <p>Your payout request (<code>${params.payoutId}</code>) for <strong>${params.currency} ${params.amount.toFixed(2)}</strong> was rejected and the reserved balance has been released back to your available balance.</p>
       <p><strong>Reason:</strong> ${params.reason}</p>`
    );
  },

  async notifyPayoutPaid(params: {
    email: string;
    name: string;
    amount: number;
    currency: string;
    payoutId: string;
    method: string;
    reference: string;
  }) {
    await safeSend(
      params.email,
      `Payout Sent — ${params.currency} ${params.amount.toFixed(2)}`,
      `<p>Hi ${params.name},</p>
       <p>Your payout of <strong>${params.currency} ${params.amount.toFixed(2)}</strong> has been marked as paid.</p>
       <ul>
         <li><strong>Method:</strong> ${params.method}</li>
         <li><strong>Reference:</strong> ${params.reference}</li>
       </ul>`
    );
  },
};
