import crypto from "crypto";
import type { Request, Response } from "express";

export const AFFILIATE_COOKIE_NAME = "pt_aff_ref";

export interface AffiliateAttributionPayload {
  clickId: string;
  affiliateId: string;
  code: string;
  exp: number; // Unix timestamp in ms
}

function getSigningSecret(): string {
  return process.env.JWT_SECRET || process.env.AFFILIATE_COOKIE_SECRET || "phukettours-affiliate-secret";
}

function sign(data: string): string {
  return crypto
    .createHmac("sha256", getSigningSecret())
    .update(data)
    .digest("base64url");
}

export function signAttributionToken(payload: AffiliateAttributionPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = sign(encoded);
  return `${encoded}.${sig}`;
}

export function verifyAttributionToken(
  token: string | undefined | null,
  nowMs: number = Date.now()
): AffiliateAttributionPayload | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encoded, providedSig] = parts;
  if (!encoded || !providedSig) return null;

  const expectedSig = sign(encoded);
  const a = Buffer.from(providedSig, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as AffiliateAttributionPayload;

    if (
      !parsed ||
      typeof parsed.clickId !== "string" ||
      typeof parsed.affiliateId !== "string" ||
      typeof parsed.code !== "string" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }

    if (parsed.exp <= nowMs) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function setAttributionCookie(
  res: Response,
  payload: AffiliateAttributionPayload
): void {
  const token = signAttributionToken(payload);
  const maxAge = Math.max(0, payload.exp - Date.now());
  const isProd = process.env.NODE_ENV === "production";

  res.cookie(AFFILIATE_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge,
    path: "/",
  });
}

export function getAttributionFromRequest(
  req: Request,
  nowMs: number = Date.now()
): AffiliateAttributionPayload | null {
  const raw = req.cookies?.[AFFILIATE_COOKIE_NAME];
  return verifyAttributionToken(raw, nowMs);
}

export function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return crypto.createHash("sha256").update(`${ip}:${getSigningSecret()}`).digest("hex").slice(0, 32);
}
