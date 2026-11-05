import 'dotenv/config';
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import authMiddleware from './shared/middleware/authMiddleware.js';
import requirePermission from './shared/middleware/requirePermission.js';

const debugRouter = Router();

// Debug middleware that logs req.user after authMiddleware
const debugAfterAuth = (req: Request, res: Response, next: NextFunction) => {
  console.log('[DEBUG] After authMiddleware: req.user =', req.user ? `role=${req.user.role}, id=${req.user.id}` : 'NOT SET');
  console.log('[DEBUG] req.headers.authorization:', req.headers.authorization?.substring(0, 30) + '...');
  console.log('[DEBUG] req.cookies?.token:', req.cookies?.token?.substring(0, 30) + '...');
  next();
};

debugRouter.get(
  "/admin/reports/bookings",
  authMiddleware,
  debugAfterAuth,
  requirePermission("reports.view"),
  (req: Request, res: Response) => {
    console.log('[DEBUG] In controller. req.user.role =', req.user?.role);
    res.json({ success: true, message: "Bookings report retrieved successfully", data: { test: true } });
  }
);

export default debugRouter;
