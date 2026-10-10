import env from "../../config/env.js";
import logger from "../logger/logger.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export const sendEmail = async (message: MailMessage): Promise<void> => {
  if (env.nodeEnv === "production") {
    logger.warn(
      { to: message.to, subject: message.subject },
      "Email not sent: no mail provider configured",
    );
    return;
  }

  logger.info(
    { to: message.to, subject: message.subject },
    `Email (console transport)\n${message.text}`,
  );
};