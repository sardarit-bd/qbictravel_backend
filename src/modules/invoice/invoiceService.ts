import { prisma } from "../../lib/prisma.js";
import logger from "../../shared/logger/logger.js";
import AppError from "../../shared/utils/AppError.js";
import type { Invoice, InvoiceType } from "../../../generated/prisma/client.js";
import { getCompanyDetails } from "./companyConfig.js";
import { generateFinancialPdfBuffer, type PdfDocumentData } from "./pdfService.js";
import * as invoiceRepository from "./invoiceRepository.js";

export interface InvoiceWithPdf {
  invoice: Invoice;
  pdfBuffer: Buffer;
  filename: string;
}

/**
 * Service to issue or retrieve an existing invoice/payment receipt for a verified payment.
 * Ensures strict idempotency: if an invoice already exists for this paymentId,
 * the existing invoice and its PDF are returned without duplicating.
 */
export const getOrCreatePaymentReceipt = async (
  bookingId: string,
  paymentId?: string,
): Promise<InvoiceWithPdf> => {
  // 1. Idempotency check: see if invoice already exists for this payment
  if (paymentId) {
    const existing = await invoiceRepository.findInvoiceByPaymentId(paymentId);
    if (existing) {
      logger.info({ invoiceId: existing.id, invoiceNumber: existing.invoiceNumber, paymentId }, "Existing payment receipt found");
      const pdf = await generateInvoicePdf(existing.id);
      return {
        invoice: existing,
        pdfBuffer: pdf.pdfBuffer,
        filename: pdf.filename,
      };
    }
  }

  // 2. Fetch booking and payments
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      service: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true, email: true, status: true } },
      guestSnapshot: { select: { guestName: true, guestEmail: true, guestPhone: true } },
      availability: { select: { date: true } },
      payments: {
        where: { status: "VERIFIED" },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!booking) {
    throw new AppError("Booking not found for invoice creation", 404);
  }

  // Find target payment or latest verified payment
  const currentPayment = paymentId
    ? booking.payments.find((p: any) => p.id === paymentId) || (await prisma.payment.findUnique({ where: { id: paymentId } }))
    : booking.payments[booking.payments.length - 1];

  const totalPaid = booking.payments.reduce(
    (sum: number, p: any) => sum + Number(p.amount),
    0,
  );

  const basePrice = Number(booking.basePrice);
  const finalPrice = Number(booking.finalPrice);
  const discount = Math.max(0, basePrice - finalPrice);
  const subtotal = basePrice;
  const paidForThisDoc = currentPayment ? Number(currentPayment.amount) : totalPaid;
  const balanceDue = Math.max(0, finalPrice - totalPaid);

  const currency = currentPayment?.currency || booking.currency || "THB";
  const docType: InvoiceType = "PAYMENT_RECEIPT";

  // Create invoice record in database
  const invoice = await invoiceRepository.createInvoice(prisma, {
    bookingId,
    paymentId: currentPayment?.id ?? null,
    type: docType,
    status: "ISSUED",
    currency,
    subtotalAmount: subtotal,
    discountAmount: discount,
    taxAmount: 0,
    totalAmount: finalPrice,
    paidAmount: paidForThisDoc,
    dueAmount: balanceDue,
    issuedAt: new Date(),
    metadata: {
      serviceName: booking.service.name,
      paymentMethod: currentPayment?.method || "ONLINE",
      paymentReference: currentPayment?.reference || null,
      isGuest: booking.isGuest,
    },
  });

  logger.info({ invoiceNumber: invoice.invoiceNumber, bookingId, paymentId }, "Payment receipt issued successfully");

  const pdf = await generateInvoicePdf(invoice.id);
  return {
    invoice,
    pdfBuffer: pdf.pdfBuffer,
    filename: pdf.filename,
  };
};

/**
 * Generate PDF buffer for an existing invoice record
 */
export const generateInvoicePdf = async (
  invoiceId: string,
): Promise<{ pdfBuffer: Buffer; filename: string }> => {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      booking: {
        include: {
          service: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true, email: true } },
          guestSnapshot: { select: { guestName: true, guestEmail: true } },
          availability: { select: { date: true } },
        },
      },
      payment: true,
    },
  });

  if (!invoice) {
    throw new AppError("Invoice record not found", 404);
  }

  const company = getCompanyDetails();
  const customerName = invoice.booking.isGuest && invoice.booking.guestSnapshot
    ? invoice.booking.guestSnapshot.guestName
    : invoice.booking.customer?.name || "Valued Customer";
  const customerEmail = invoice.booking.isGuest && invoice.booking.guestSnapshot
    ? invoice.booking.guestSnapshot.guestEmail
    : invoice.booking.customer?.email || "";

  const title =
    invoice.type === "TAX_INVOICE"
      ? "TAX INVOICE"
      : invoice.type === "INTERIM_STATEMENT"
        ? "INTERIM STATEMENT"
        : "PAYMENT RECEIPT";

  const pdfData: PdfDocumentData = {
    title,
    documentNumber: invoice.invoiceNumber,
    issueDate: invoice.issuedAt.toISOString().split("T")[0],
    bookingReference: invoice.bookingId.substring(0, 8).toUpperCase(),
    serviceName: invoice.booking.service.name,
    travelDate: invoice.booking.availability?.date
      ? new Date(invoice.booking.availability.date).toISOString().split("T")[0]
      : null,
    customerName,
    customerEmail,
    paymentMethod: invoice.payment?.method || "VERIFIED",
    paymentDate: invoice.payment?.createdAt
      ? new Date(invoice.payment.createdAt).toISOString().split("T")[0]
      : invoice.issuedAt.toISOString().split("T")[0],
    currency: invoice.currency,
    subtotal: Number(invoice.subtotalAmount),
    discount: Number(invoice.discountAmount),
    tax: Number(invoice.taxAmount),
    amountPaid: Number(invoice.paidAmount),
    dueAmount: Number(invoice.dueAmount),
    company,
  };

  const pdfBuffer = generateFinancialPdfBuffer(pdfData);
  const filename = `${invoice.invoiceNumber}.pdf`;

  return { pdfBuffer, filename };
};
