import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import env from "../../config/env.js";
import logger from "../logger/logger.js";
import AppError from "./AppError.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailDeliveryResult {
  success: boolean;
  messageId?: string;
  accepted?: string[];
  rejected?: string[];
}

import { getRuntimeSmtpConfig } from "../../modules/setting/settingRuntimeConfig.js";

let cachedTransporter: Transporter | null = null;
let cachedTransporterFingerprint = "";

export const getTransporter = (): Transporter | null => {
  if (!env.smtpHost) {
    return null;
  }

  if (cachedTransporter) {
    return cachedTransporter;
  }

  cachedTransporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: env.smtpUser
      ? {
          user: env.smtpUser,
          pass: env.smtpPass,
        }
      : undefined,
  } as any);
  return cachedTransporter;
};

export const getDynamicTransporter = async (): Promise<{
  transporter: Transporter | null;
  fromHeader: string;
  enabled: boolean;
}> => {
  const smtpConfig = await getRuntimeSmtpConfig();
  if (!smtpConfig.enabled || !smtpConfig.host) {
    return {
      transporter: null,
      fromHeader: `"${smtpConfig.fromName || env.smtpFromName}" <${smtpConfig.fromEmail || env.smtpFromEmail}>`,
      enabled: smtpConfig.enabled,
    };
  }

  const fingerprint = `${smtpConfig.host}:${smtpConfig.port}:${smtpConfig.secure}:${smtpConfig.user}:${smtpConfig.pass}`;
  if (cachedTransporter && cachedTransporterFingerprint === fingerprint) {
    return {
      transporter: cachedTransporter,
      fromHeader: `"${smtpConfig.fromName}" <${smtpConfig.fromEmail}>`,
      enabled: true,
    };
  }

  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: smtpConfig.user
      ? {
          user: smtpConfig.user,
          pass: smtpConfig.pass,
        }
      : undefined,
  } as any);

  cachedTransporter = transporter;
  cachedTransporterFingerprint = fingerprint;

  return {
    transporter,
    fromHeader: `"${smtpConfig.fromName}" <${smtpConfig.fromEmail}>`,
    enabled: true,
  };
};

export const resetTransporter = (): void => {
  cachedTransporter = null;
  cachedTransporterFingerprint = "";
};

export const sendEmail = async (message: MailMessage): Promise<MailDeliveryResult> => {
  const { transporter, fromHeader } = await getDynamicTransporter();

  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: fromHeader,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });

      const accepted = Array.isArray(info.accepted)
        ? (info.accepted as string[])
        : [];
      const rejected = Array.isArray(info.rejected)
        ? (info.rejected as string[])
        : [];

      if (rejected.length > 0 && accepted.length === 0) {
        logger.error(
          { to: message.to, rejected, subject: message.subject },
          "SMTP provider rejected recipient",
        );
        throw new AppError("Email delivery rejected by mail server", 502);
      }

      logger.info(
        {
          messageId: info.messageId,
          to: message.to,
          subject: message.subject,
          acceptedCount: accepted.length,
        },
        "Email delivered successfully via SMTP provider",
      );

      return {
        success: true,
        messageId: info.messageId,
        accepted,
        rejected,
      };
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string; command?: string };
      logger.error(
        {
          errCode: err.code,
          errMsg: err.message,
          to: message.to,
          subject: message.subject,
        },
        "Failed to send email via SMTP",
      );
      throw error;
    }
  }

  // Fallback when SMTP is not configured
  if (env.nodeEnv === "production") {
    logger.error(
      { to: message.to, subject: message.subject },
      "Email delivery failed: SMTP is not configured in production environment",
    );
    throw new AppError("Mail service unconfigured", 503);
  }

  logger.warn(
    { to: message.to, subject: message.subject },
    "Email not sent via SMTP (SMTP_HOST not configured): logged to console for development/test",
  );
  logger.info(
    { to: message.to, subject: message.subject },
    `[Simulated Email Body]\n${message.text}`,
  );

  return {
    success: true,
    messageId: `simulated-${Date.now()}`,
    accepted: [message.to],
    rejected: [],
  };
};