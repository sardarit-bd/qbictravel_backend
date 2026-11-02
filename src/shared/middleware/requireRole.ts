import type { Request, Response, NextFunction } from "express";
import AppError from "../utils/AppError.js";
import type { UserRole } from "../../types/common.js";

const requireRole =
  (...roles: UserRole[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError("Unauthorized", 401));
    }

    if (!roles.includes(req.user.role)) {
      return next(new AppError("Forbidden: insufficient permissions", 403));
    }

    next();
  };

export default requireRole;