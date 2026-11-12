import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
// import { xss } from "express-xss-sanitizer";
import httpLogger from "./shared/logger/httpLogger.js";
import errorHandler from "./shared/errors/errorHandler.js";
import swaggerUi from "swagger-ui-express";
import authRoutes from "./modules/auth/authRoutes.js";
import swaggerSpec from "./config/swagger.js";
import cookieParser from "cookie-parser";
import userRoutes from "./modules/user/userRoutes.js";
import adminRoutes from "./modules/admin/adminRoutes.js";
import serviceRoutes from "./modules/service/serviceRoutes.js";
import pricingRoutes from "./modules/pricing/pricingRoutes.js";
import bookingRoutes from "./modules/booking/bookingRoutes.js";
import paymentRoutes from "./modules/payment/paymentRoutes.js";
import operationsRoutes from "./modules/operations/operationsRoutes.js";
import notificationRoutes from "./modules/notification/notificationRoutes.js";
import commissionRoutes from "./modules/commission/commissionRoutes.js";
import reportRoutes from "./modules/report/reportRoutes.js";
import mediaRoutes from "./modules/media/mediaRoutes.js";
import permissionRoutes, { myPermissionsRouter } from "./modules/permission/permissionRoutes.js";
import agentRoutes from "./modules/agent/agentRoutes.js";
import settingRoutes from "./modules/setting/settingRoutes.js";
import customerRoutes from "./modules/customer/customerRoutes.js";
import { handleStripeWebhook, handlePayPalWebhook } from "./modules/payment/paymentController.js";
import { csrfProtectionMiddleware } from "./shared/middleware/csrfMiddleware.js";
const swaggerCustomCss = `
  body {
    background-color: #0000;
  }
  .swagger-ui {
    filter: invert(88%) hue-rotate(180deg);
  }
  .swagger-ui .microlight {
    filter: invert(100%) hue-rotate(180deg);
  }
  .swagger-ui .topbar {
    display: none;
  }
  .swagger-ui .btn.authorize {
    border-color: #6366f1;
    color: #6366f1;
  }
  .swagger-ui .btn.authorize svg {
    fill: #6366f1;
  }
  .swagger-ui .opblock-tag {
    border-bottom: 1px solid #6366f1;
  }
  .swagger-ui .opblock.opblock-post {
    border-color: #6366f1;
    background: #000000;
  }
  .swagger-ui .opblock.opblock-post .opblock-summary-method {
    background-color: #6366f1;
  }
  .swagger-ui .opblock.opblock-get .opblock-summary-method {
    background-color: #6366f1;
    filter: brightness(1.3);
  }
  .swagger-ui .scheme-container {
    background-color: #000000;
    box-shadow: none;
  }
`;
const app = express();
app.set("trust proxy", 1);
app.use(httpLogger);
const ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://192.168.0.105:3000",
    "https://phukettours.com",
    "https://www.phukettours.com",
    "http://72.61.112.137",
    "https://72.61.112.137",
    "https://app.whed.sardarit.cloud",
];
// If FRONTEND_URL is set in environment (e.g., custom deployed frontend or comma-separated list), ensure it is included
if (process.env.FRONTEND_URL) {
    const configuredUrls = process.env.FRONTEND_URL.split(",")
        .map((url) => url.trim())
        .filter(Boolean);
    for (const url of configuredUrls) {
        if (!ALLOWED_ORIGINS.includes(url)) {
            ALLOWED_ORIGINS.push(url);
        }
    }
}
// 1. CORS middleware must execute BEFORE all rate limiters and route handlers
// to ensure every response (including 429 Too Many Requests) includes CORS headers.
app.use(cors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
// 2. Global rate limiter (skips preflight OPTIONS requests)
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => process.env.NODE_ENV === "test" || req.method === "OPTIONS",
}));
// 3. Dedicated Stripe Webhook raw body parser mounted BEFORE global express.json()
// Stripe signature verification requires the exact unmodified raw byte buffer.
app.post("/api/v1/webhooks/stripe", express.raw({ type: "application/json", limit: "2mb" }), handleStripeWebhook);
// 3b. Dedicated PayPal Webhook parser
app.post("/api/v1/webhooks/paypal", express.json({ limit: "2mb" }), handlePayPalWebhook);
app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());
app.use(helmet());
app.use(csrfProtectionMiddleware(ALLOWED_ORIGINS));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: swaggerCustomCss,
    customSiteTitle: "Express API Docs",
}));
app.get("/api-docs", (req, res) => {
    res.redirect("/api-docs/");
});
app.get("/", (req, res) => {
    res.send("right think");
});
app.use("/api/v1/auth", myPermissionsRouter);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1", serviceRoutes);
app.use("/api/v1/admin/media", mediaRoutes);
app.use("/api/v1/admin", permissionRoutes);
app.use("/api/v1", settingRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/agent", agentRoutes);
app.use("/api/v1", pricingRoutes);
app.use("/api/v1", bookingRoutes);
app.use("/api/v1", paymentRoutes);
app.use("/api/v1", operationsRoutes);
app.use("/api/v1", notificationRoutes);
app.use("/api/v1", commissionRoutes);
app.use("/api/v1", reportRoutes);
app.use("/api/v1", customerRoutes);
app.use(errorHandler);
export default app;
