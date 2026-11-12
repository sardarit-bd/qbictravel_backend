import { Request, Response, NextFunction } from "express";
import env from "../../config/env.js";
import sendResponse from "../../shared/utils/response.js";
import { getOwnProfile } from "../user/userService.js";
import {
  registerUser,
  loginUser,
  refreshSession as refreshSessionService,
  logoutUser,
  logoutByRefreshToken,
  logoutAllSessions as logoutAllSessionsService,
  forgotPassword as forgotPasswordService,
  resetPassword as resetPasswordService,
  validateInvitationToken,
  validateResetPasswordToken,
} from "./authService.js";

const isProduction = env.nodeEnv === "production";
const REFRESH_COOKIE_NAME = "pt_refresh";
const REFRESH_COOKIE_MAX_AGE_MS =
  env.refreshTokenTtlDays * 24 * 60 * 60 * 1000;
const LEGACY_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const getRefreshCookieOptions = () => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: (isProduction ? "none" : "lax") as "none" | "lax",
  path: "/api/v1/auth",
  domain: env.cookieDomain,
  maxAge: REFRESH_COOKIE_MAX_AGE_MS,
});

export const getLegacyCookieOptions = () => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: (isProduction ? "none" : "lax") as "none" | "lax",
  path: "/",
  domain: env.cookieDomain,
  maxAge: LEGACY_COOKIE_MAX_AGE_MS,
});

export const register = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const context = {
      userAgent: req.headers["user-agent"] || undefined,
      ipAddress: req.ip || undefined,
    };
    const result = await registerUser(req.body, context);

    // 1. Set opaque rotating refresh token in HttpOnly cookie scoped to /api/v1/auth
    if (result.refreshToken) {
      res.cookie(
        REFRESH_COOKIE_NAME,
        result.refreshToken,
        getRefreshCookieOptions(),
      );
    }

    // 2. Set legacy cookie for backward-compatible fallback clients
    res.cookie("token", result.token, getLegacyCookieOptions());

    sendResponse(res, 201, true, "User registered successfully", {
      ...result.user,
      accessToken: result.accessToken || result.token,
      token: result.token,
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const context = {
      userAgent: req.headers["user-agent"] || undefined,
      ipAddress: req.ip || undefined,
    };
    const result = await loginUser(req.body, context);

    // 1. Set opaque rotating refresh token in HttpOnly cookie scoped to /api/v1/auth
    if (result.refreshToken) {
      res.cookie(
        REFRESH_COOKIE_NAME,
        result.refreshToken,
        getRefreshCookieOptions(),
      );
    }

    // 2. Set legacy cookie for backward-compatible fallback clients
    res.cookie("token", result.token, getLegacyCookieOptions());

    sendResponse(res, 200, true, "Login successful", {
      ...result.user,
      accessToken: result.accessToken || result.token,
      token: result.token,
    });
  } catch (error) {
    next(error);
  }
};

export const refresh = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const rawRefreshToken =
      req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;

    const context = {
      userAgent: req.headers["user-agent"] || undefined,
      ipAddress: req.ip || undefined,
    };

    const result = await refreshSessionService(rawRefreshToken, context);

    // Rotate refresh token cookie
    if (result.refreshToken) {
      res.cookie(
        REFRESH_COOKIE_NAME,
        result.refreshToken,
        getRefreshCookieOptions(),
      );
    }

    // Update legacy cookie as well
    res.cookie("token", result.token, getLegacyCookieOptions());

    sendResponse(res, 200, true, "Token refreshed successfully", {
      ...result.user,
      accessToken: result.accessToken || result.token,
      token: result.token,
    });
  } catch (error) {
    // If refresh fails, clear both cookies
    res.clearCookie(REFRESH_COOKIE_NAME, {
      ...getRefreshCookieOptions(),
      maxAge: undefined,
    });
    res.clearCookie("token", {
      ...getLegacyCookieOptions(),
      maxAge: undefined,
    });
    next(error);
  }
};

export const logout = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // 1. If authenticated via authMiddleware, revoke current session
    if (req.auth) {
      await logoutUser(req.auth);
    }

    // 2. Also revoke by refresh token cookie if present
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (rawRefreshToken) {
      await logoutByRefreshToken(rawRefreshToken);
    }

    // 3. Clear both cookies
    res.clearCookie(REFRESH_COOKIE_NAME, {
      ...getRefreshCookieOptions(),
      maxAge: undefined,
    });
    res.clearCookie("token", {
      ...getLegacyCookieOptions(),
      maxAge: undefined,
    });

    sendResponse(res, 200, true, "Logged out successfully");
  } catch (error) {
    next(error);
  }
};

export const logoutAll = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    await logoutAllSessionsService(req.user!.id);

    res.clearCookie(REFRESH_COOKIE_NAME, {
      ...getRefreshCookieOptions(),
      maxAge: undefined,
    });
    res.clearCookie("token", {
      ...getLegacyCookieOptions(),
      maxAge: undefined,
    });

    sendResponse(res, 200, true, "Logged out of all sessions successfully");
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    await forgotPasswordService(req.body);

    sendResponse(
      res,
      200,
      true,
      "If an account exists for this email, a password reset link has been sent",
    );
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    await resetPasswordService(req.body);

    sendResponse(res, 200, true, "Password has been reset successfully");
  } catch (error) {
    next(error);
  }
};

export const validateResetToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const token = (req.query.token as string) || (req.body && req.body.token);
    const result = await validateResetPasswordToken(token);
    sendResponse(res, 200, true, "Password reset token is valid", result);
  } catch (error) {
    next(error);
  }
};

export const validateInvitation = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const token = (req.query.token as string) || (req.body && req.body.token);
    const result = await validateInvitationToken(token);
    sendResponse(res, 200, true, "Invitation token is valid", result);
  } catch (error) {
    next(error);
  }
};

export const setupPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    await resetPasswordService(req.body);
    sendResponse(
      res,
      200,
      true,
      "Account password has been established successfully. You may now sign in.",
    );
  } catch (error) {
    next(error);
  }
};

export const me = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const profile = await getOwnProfile(req.user!.id);

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        message: "Profile retrieved successfully",
        data: profile,
      }),
    );
  } catch (error) {
    next(error);
  }
};