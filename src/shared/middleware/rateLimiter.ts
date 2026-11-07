import rateLimit from "express-rate-limit";
import env from "../../config/env.js";

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