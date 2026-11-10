import crypto from "crypto";

/**
 * Generate a cryptographically secure random 32-byte token (hex encoded, 64 chars)
 */
export const generateSecureToken = (): string => {
  return crypto.randomBytes(32).toString("hex");
};

/**
 * Hash a plain token using SHA-256 for persistent database storage and lookup
 */
export const hashToken = (token: string): string => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

