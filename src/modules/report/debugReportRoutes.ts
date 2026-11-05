import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requirePermission from "../../shared/middleware/requirePermission.js";

const router = Router();

// Add a debug route that logs exactly what happens
router.get("/admin/reports/debug-test", authMiddleware, requirePermission("reports.view"), (req: Request, res: Response) => {
  console.log('[DEBUG CONTROLLER] req.user:', JSON.stringify(req.user));
  res.json({ 
    success: true, 
    message: "Debug test passed",
    data: { 
      userRole: req.user?.role,
      userId: req.user?.id 
    } 
  });
});

export default router;
