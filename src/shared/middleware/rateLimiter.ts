import rateLimit from "express-rate-limit";
import env from "../../config/env.js";

/**
 * Strict rate limiter for brute-force sensitive authentication entry points
 * such as login and password reset requests.
 * Allows 10 requests per 15-minute window per IP.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => env.nodeEnv === "test" || req.method === "OPTIONS",
  message: {
    success: false,
    message: "Too many attempts, please try again later",
    data: null,
  },
});

/**
 * Dedicated rate limiter for session token refresh operations.
 * Allows legitimate background polling, multi-tab browsing, and page reloads
 * (120 requests per 15-minute window per IP) while preventing abusive resource flooding.
 */
export const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => env.nodeEnv === "test" || req.method === "OPTIONS",
  message: {
    success: false,
    message: "Too many refresh attempts, please try again later",
    data: null,
  },
});

/**
 * Public rate limiter for public booking operations (e.g. Guest Checkout)
 * to prevent automated scraping or submission flooding.
 * Allows 20 requests per 15-minute window per IP.
 */
export const guestCheckoutRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => env.nodeEnv === "test" || req.method === "OPTIONS",
  message: {
    success: false,
    message: "Too many checkout requests, please try again later",
    data: null,
  },
});

/**
 * Public rate limiter for guest magic-link itinerary access
 * to prevent brute-force token enumeration.
 * Allows 30 requests per 15-minute window per IP.
 */
export const guestAccessRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => env.nodeEnv === "test" || req.method === "OPTIONS",
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
    data: null,
  },
});
