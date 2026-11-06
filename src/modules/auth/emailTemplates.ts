export interface InvitationEmailOptions {
  name: string;
  email: string;
  setupUrl: string;
  expiresHours: number;
}

export interface PasswordResetEmailOptions {
  name: string;
  email: string;
  resetUrl: string;
  expiresMinutes: number;
}

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export const getStaffInvitationEmail = ({
  name,
  setupUrl,
  expiresHours,
}: InvitationEmailOptions): EmailContent => {
  const subject = "Welcome to PhuketTours — Set Up Your Staff Account";

  const text = `Hello ${name},

You have been invited to join the PhuketTours Operations & Administration team as a Staff member.

To complete your account onboarding and set up your password, please open the following link in your browser:
${setupUrl}

Important: This invitation link is personal to you and will expire in ${expiresHours} hours.

If you have questions or did not expect this invitation, please contact your PhuketTours administrator.

Best regards,
The PhuketTours Team`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #F8FAFB; color: #18282A; }
    .wrapper { width: 100%; max-width: 600px; margin: 32px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #E5EAED; box-shadow: 0 4px 12px rgba(0,0,0,0.04); }
    .header { background: linear-gradient(135deg, #176779 0%, #0E424E 100%); padding: 36px 32px; text-align: center; }
    .brand { font-size: 26px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px; margin: 0; }
    .brand-sub { font-size: 13px; color: #A7D7E0; margin-top: 4px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600; }
    .content { padding: 36px 32px 32px; }
    .greeting { font-size: 18px; font-weight: 600; color: #18282A; margin-top: 0; margin-bottom: 16px; }
    .message { font-size: 15px; line-height: 1.6; color: #465457; margin-bottom: 24px; }
    .badge { display: inline-block; background-color: #EBF3F5; color: #176779; font-weight: 600; font-size: 12px; padding: 4px 12px; rounded: 6px; border-radius: 6px; margin-bottom: 20px; }
    .cta-box { text-align: center; margin: 32px 0; }
    .btn { display: inline-block; background-color: #2B9BA8; color: #ffffff !important; text-decoration: none; font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 9999px; box-shadow: 0 2px 6px rgba(43,155,168,0.3); }
    .btn:hover { background-color: #176779; }
    .details { background-color: #F8FAFB; border: 1px solid #E5EAED; border-radius: 12px; padding: 20px; margin-bottom: 24px; font-size: 13px; color: #5C6C6E; }
    .details-row { margin-bottom: 8px; }
    .details-row:last-child { margin-bottom: 0; }
    .details-label { font-weight: 600; color: #18282A; }
    .fallback-url { font-size: 12px; color: #74818A; word-break: break-all; margin-top: 20px; }
    .footer { padding: 24px 32px; background-color: #F8FAFB; border-top: 1px solid #E5EAED; text-align: center; font-size: 12px; color: #8A9A9C; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1 class="brand">PhuketTours</h1>
      <div class="brand-sub">Operations & Administration</div>
    </div>
    <div class="content">
      <div class="badge">Staff Invitation</div>
      <h2 class="greeting">Welcome, ${name}!</h2>
      <p class="message">
        You have been invited to join the <strong>PhuketTours</strong> team as an authorized Staff member.
        Your account gives you operational access to manage bookings, services, and guest itineraries.
      </p>
      <div class="cta-box">
        <a href="${setupUrl}" class="btn" target="_blank">Set Up Your Staff Account</a>
      </div>
      <div class="details">
        <div class="details-row"><span class="details-label">Invitation Expiration:</span> ${expiresHours} hours from issuance</div>
        <div class="details-row"><span class="details-label">Security:</span> Single-use link to create your confidential password</div>
      </div>
      <p class="fallback-url">
        If the button above does not work, copy and paste this link into your browser:<br>
        <a href="${setupUrl}" style="color: #2B9BA8;">${setupUrl}</a>
      </p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} PhuketTours. All rights reserved.<br>
      If you did not expect this invitation, please disregard this email.
    </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
};

export const getAgentInvitationEmail = ({
  name,
  setupUrl,
  expiresHours,
}: InvitationEmailOptions): EmailContent => {
  const subject = "Welcome to PhuketTours Partner Portal — Set Up Your Account";

  const text = `Hello ${name},

You have been invited to join the PhuketTours Partner Network as an authorized Travel Agent.

To set up your partner account password, please visit:
${setupUrl}

This link is valid for ${expiresHours} hours.

Best regards,
The PhuketTours Team`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #F8FAFB; color: #18282A; }
    .wrapper { max-width: 600px; margin: 32px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #E5EAED; }
    .header { background: #176779; padding: 32px; text-align: center; color: white; }
    .content { padding: 32px; }
    .btn { display: inline-block; background-color: #2B9BA8; color: white !important; padding: 14px 28px; border-radius: 9999px; text-decoration: none; font-weight: 600; margin: 24px 0; }
    .footer { padding: 20px 32px; background-color: #F8FAFB; font-size: 12px; color: #8A9A9C; text-align: center; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1 style="margin:0; font-size:24px;">PhuketTours Partner Portal</h1>
    </div>
    <div class="content">
      <h2>Welcome, ${name}!</h2>
      <p>You have been invited to join the PhuketTours Partner Network as an authorized Travel Agent.</p>
      <div style="text-align: center;">
        <a href="${setupUrl}" class="btn">Set Up Partner Account</a>
      </div>
      <p style="font-size:13px; color:#5C6C6E;">This link will expire in ${expiresHours} hours.</p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} PhuketTours. All rights reserved.
    </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
};

export const getPasswordResetEmail = ({
  name,
  resetUrl,
  expiresMinutes,
}: PasswordResetEmailOptions): EmailContent => {
  const subject = "PhuketTours — Reset Your Password";

  const text = `Hello ${name},

We received a request to reset your PhuketTours account password.

To set a new password, please visit:
${resetUrl}

This link is valid for ${expiresMinutes} minutes. If you did not request a password reset, you can safely ignore this email.

Best regards,
The PhuketTours Team`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #F8FAFB; color: #18282A; }
    .wrapper { max-width: 600px; margin: 32px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #E5EAED; }
    .header { background: #176779; padding: 32px; text-align: center; color: white; }
    .content { padding: 32px; }
    .btn { display: inline-block; background-color: #2B9BA8; color: white !important; padding: 14px 28px; border-radius: 9999px; text-decoration: none; font-weight: 600; margin: 24px 0; }
    .footer { padding: 20px 32px; background-color: #F8FAFB; font-size: 12px; color: #8A9A9C; text-align: center; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1 style="margin:0; font-size:24px;">PhuketTours</h1>
    </div>
    <div class="content">
      <h2>Hello, ${name}</h2>
      <p>We received a request to reset the password for your PhuketTours account.</p>
      <div style="text-align: center;">
        <a href="${resetUrl}" class="btn">Reset Password</a>
      </div>
      <p style="font-size:13px; color:#5C6C6E;">This link will expire in ${expiresMinutes} minutes. If you did not make this request, you can safely ignore this email.</p>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} PhuketTours. All rights reserved.
    </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
};
