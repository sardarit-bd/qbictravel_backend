import { Router } from "express";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import { streamDashboardEvents } from "./eventController.js";

const router = Router();

// Secure SSE Stream endpoint requiring authenticated session
router.get("/events/stream", authMiddleware, streamDashboardEvents);

export default router;
