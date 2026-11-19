import { Router } from "express";
import * as invoiceController from "./invoiceController.js";
import authMiddleware from "../../shared/middleware/authMiddleware.js";
import requireRole from "../../shared/middleware/requireRole.js";

const router = Router();

// Secure authenticated invoice download endpoint
router.get(
  "/customer/invoices/:invoiceId/download",
  authMiddleware,
  requireRole("customer", "affiliate", "admin", "staff"),
  invoiceController.downloadCustomerInvoice,
);

export default router;
