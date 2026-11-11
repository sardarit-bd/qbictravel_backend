import type { Request, Response, NextFunction } from "express";
import AppError from "../utils/AppError.js";
import env from "../../config/env.js";

/**
 * Validates Origin / Referer on cookie-authenticated state-changing requests
 * to prevent Cross-Site Request Forgery (CSRF).
 *
 * Requests carrying an explicit Authorization Bearer header are naturally immune
 * to browser cross-site ambient credential transmission and bypass this check.
 */
export const csrfProtectionMiddleware = (
  allowedOrigins: string[],
) => {
  const allowedSet = new Set(
    allowedOrigins.map((o) => o.replace(/\/+$/, "").toLowerCase()),
  );

  return (req: Request, _res: Response, next: NextFunction): void => {
    // 1. Safe HTTP methods don't mutate state
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return next();
    }

    // 2. Authorization: Bearer requests are immune to ambient browser cookie CSRF
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      return next();
    }

    // 3. Webhook endpoints have dedicated signature verifications
    if (req.path.startsWith("/api/v1/webhooks/")) {
      return next();
    }

    // 4. In test environment, skip CSRF check unless test specifically passes x-test-csrf-check: true
    if (
      process.env.NODE_ENV === "test" ||
      env.nodeEnv === "test"
    ) {
      if (req.headers["x-test-csrf-check"] === "true") {
        // Enforce check below
      } else {
        return next();
      }
    }

    // 5. Check if ambient cookies are present in the request. If no cookies are sent, CSRF does not apply.
    const hasCookies =
      req.cookies &&
      (req.cookies.token || req.cookies.pt_refresh);

    const origin = req.headers.origin;
    let requestOrigin: string | null = null;

    if (origin && typeof origin === "string") {
      requestOrigin = origin.replace(/\/+$/, "").toLowerCase();
    } else if (req.headers.referer && typeof req.headers.referer === "string") {
      try {
        const refUrl = new URL(req.headers.referer);
        requestOrigin = refUrl.origin.replace(/\/+$/, "").toLowerCase();
      } catch {
        requestOrigin = null;
      }
    }

    // If cookies were sent or an Origin header is explicitly sent (browser fetch/XHR), validate origin
    if (hasCookies || origin) {
      if (!requestOrigin || !allowedSet.has(requestOrigin)) {
        return next(
          new AppError(
            "Cross-site request blocked: Invalid or untrusted origin.",
            403,
          ),
        );
      }
    }

    return next();
  };
};
