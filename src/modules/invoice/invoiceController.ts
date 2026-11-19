import type { Request, Response, NextFunction } from "express";
import { prisma } from "../../lib/prisma.js";
import AppError from "../../shared/utils/AppError.js";
import { generateInvoicePdf } from "./invoiceService.js";

/**
 * GET /api/v1/customer/invoices/:invoiceId/download
 * Secure download endpoint for authenticated customers to access their invoices/receipts.
 */
export const downloadCustomerInvoice = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const customerId = (req as any).user?.id as string | undefined;
    const invoiceId = req.params.invoiceId as string;

    if (!customerId) {
      throw new AppError("Authentication required", 401);
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        booking: {
          select: { customerId: true },
        },
      },
    });

    if (!invoice || !invoice.booking) {
      throw new AppError("Invoice not found", 404);
    }

    // Authorization check: Customer can only access their own invoices
    if (invoice.booking.customerId !== customerId) {
      throw new AppError("You do not have permission to access this financial document", 403);
    }

    const { pdfBuffer, filename } = await generateInvoicePdf(invoice.id);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};
