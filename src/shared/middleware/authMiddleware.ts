import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import env from "../../config/env.js";
import {
  findAuthUserById,
  isTokenRevoked,
} from "../../modules/auth/authRepository.js";
import type { TokenPayload } from "../../modules/auth/authTypes.js";
import AppError from "../utils/AppError.js";

const INVALID_TOKEN_MESSAGE = "Invalid or expired token";

const extractToken = (req: Request): string | null => {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.split(" ")[1] || null;
  }

  const cookieToken = req.cookies?.token;
  return typeof cookieToken === "string" && cookieToken ? cookieToken : null;
};

const verifyToken = (token: string): TokenPayload | null => {
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as TokenPayload;

    if (
      typeof decoded.id !== "string" ||
      typeof decoded.jti !== "string" ||
      typeof decoded.exp !== "number" ||
      typeof decoded.tv !== "number"
    ) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
};

const authMiddleware = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const token = extractToken(req);

  if (!token) {
    return next(new AppError("Unauthorized, token missing", 401));
  }

  const payload = verifyToken(token);

  if (!payload) {
    return next(new AppError(INVALID_TOKEN_MESSAGE, 401));
  }

  if (await isTokenRevoked(payload.jti)) {
    return next(new AppError(INVALID_TOKEN_MESSAGE, 401));
  }

  const user = await findAuthUserById(payload.id);

  if (!user || user.tokenVersion !== payload.tv) {
    return next(new AppError(INVALID_TOKEN_MESSAGE, 401));
  }

  if (user.status !== "active") {
    return next(new AppError("Account is deactivated", 403));
  }

  req.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
  req.auth = { jti: payload.jti, exp: payload.exp };

  return next();
};

export default authMiddleware;
