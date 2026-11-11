import crypto from "crypto";
import logger from "../../shared/logger/logger.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 12 bytes recommended for GCM
const AUTH_TAG_LENGTH = 16; // 16 bytes authentication tag for GCM

/**
 * Derives a strictly 32-byte key from the environment.
 * Prioritizes SETTINGS_ENCRYPTION_KEY, then falls back to JWT_SECRET.
 */
export const getEncryptionKey = (customKey?: string): Buffer => {
  const masterKey = customKey || process.env.SETTINGS_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!masterKey) {
    throw new Error(
      "Missing master encryption key: neither SETTINGS_ENCRYPTION_KEY nor JWT_SECRET is configured."
    );
  }
  return crypto.createHash("sha256").update(masterKey).digest();
};

/**
 * Encrypts sensitive credentials using authenticated AES-256-GCM.
 * Output format: iv:authTag:ciphertext in hex encoding.
 */
export const encryptSecret = (plaintext: string, customKey?: string): string => {
  if (!plaintext || typeof plaintext !== "string") {
    throw new Error("Plaintext must be a non-empty string to encrypt.");
  }

  const key = getEncryptionKey(customKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
};

/**
 * Decrypts AES-256-GCM encrypted ciphertext.
 * Fails safely and throws an error if authentication tag verification fails.
 */
export const decryptSecret = (ciphertext: string, customKey?: string): string => {
  if (!ciphertext || typeof ciphertext !== "string") {
    throw new Error("Ciphertext must be a valid formatted string to decrypt.");
  }

  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid ciphertext structure. Expected iv:authTag:ciphertext.");
  }

  const [ivHex, authTagHex, encryptedHex] = parts;

  // Strict hexadecimal string format validation
  const isHex = (str: string) => str.length > 0 && str.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(str);

  if (!isHex(ivHex) || !isHex(authTagHex) || !isHex(encryptedHex)) {
    throw new Error("Invalid ciphertext structure. Non-hexadecimal characters detected.");
  }

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid initialization vector length: expected ${IV_LENGTH} bytes, got ${iv.length}.`);
  }

  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`Invalid authentication tag length: expected ${AUTH_TAG_LENGTH} bytes, got ${authTag.length}.`);
  }

  const key = getEncryptionKey(customKey);

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    logger.error(
      { error: (error as Error).message },
      "Authenticated decryption failed. Secret could not be decrypted."
    );
    throw new Error("Decryption failed: corrupted data or invalid authentication tag.");
  }
};

/**
 * Safely masks secret values for administrative display.
 * Shows trailing 4 characters if length > 4, otherwise masked bullets.
 * Never exposes full secret values.
 */
export const maskSecret = (value: string | null | undefined): string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.length <= 4) {
    return "••••••••";
  }
  const last4 = trimmed.slice(-4);
  return `••••••••••••${last4}`;
};

/**
 * Returns true if a given value is already masked.
 */
export const isMaskedValue = (value: string | null | undefined): boolean => {
  if (!value || typeof value !== "string") return false;
  return value.includes("••••");
};

/**
 * Cryptographically verifies an HMAC SHA-256 webhook signature with timing-safe comparison.
 */
export const verifyWebhookSignature = (
  payload: string,
  signatureHeader: string,
  signingSecret: string
): boolean => {
  if (!payload || !signatureHeader || !signingSecret) return false;

  // Strip optional 'sha256=' prefix if present
  const cleanSignature = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice(7)
    : signatureHeader;

  const hmac = crypto.createHmac("sha256", signingSecret);
  hmac.update(payload);
  const expectedSignature = hmac.digest("hex");

  if (cleanSignature.length !== expectedSignature.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(cleanSignature, "utf8"),
    Buffer.from(expectedSignature, "utf8")
  );
};

