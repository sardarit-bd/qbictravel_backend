import { prisma } from "../../lib/prisma.js";
import type { Invoice, InvoiceStatus, InvoiceType } from "../../../generated/prisma/client.js";

type PrismaTx = any;

export interface CreateInvoiceParams {
  bookingId: string;
  paymentId?: string | null;
  type?: InvoiceType;
  status?: InvoiceStatus;
  currency: string;
  subtotalAmount: number;
  discountAmount?: number;
  taxAmount?: number;
  totalAmount: number;
  paidAmount: number;
  dueAmount?: number;
  issuedAt?: Date;
  pdfUrl?: string | null;
  metadata?: Record<string, any>;
}

/**
 * Generate a unique, monotonic invoice number: PT-[TYPE]-YYYYMM-XXXX
 * Uses database sequence/count safely within the current month.
 */
export const generateUniqueInvoiceNumber = async (
  client: PrismaTx | typeof prisma,
  type: InvoiceType = "PAYMENT_RECEIPT",
): Promise<string> => {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prefixType = type === "TAX_INVOICE" ? "TAX" : type === "PAYMENT_RECEIPT" ? "REC" : "STMT";
  const prefix = `PT-${prefixType}-${yearMonth}-`;

  // Count existing invoices for this month and prefix to find next sequence
  const count = await client.invoice.count({
    where: {
      invoiceNumber: {
        startsWith: prefix,
      },
    },
  });

  const nextSeq = count + 1;
  let candidate = `${prefix}${String(nextSeq).padStart(4, "0")}`;

  // Collision safety: check if candidate exists (e.g. from parallel race)
  let existing = typeof client?.invoice?.findUnique === "function"
    ? await client.invoice.findUnique({
        where: { invoiceNumber: candidate },
      })
    : null;

  let offset = 0;
  while (existing && offset < 100) {
    offset++;
    candidate = `${prefix}${String(nextSeq + offset).padStart(4, "0")}`;
    existing = typeof client?.invoice?.findUnique === "function"
      ? await client.invoice.findUnique({
          where: { invoiceNumber: candidate },
        })
      : null;
  }

  return candidate;
};

/**
 * Find invoice by payment ID (idempotency check)
 */
export const findInvoiceByPaymentId = async (
  paymentId: string,
): Promise<Invoice | null> => {
  return prisma.invoice.findFirst({
    where: { paymentId },
    include: {
      booking: true,
      payment: true,
    },
  });
};

/**
 * Find invoice by booking ID
 */
export const findInvoicesByBookingId = async (
  bookingId: string,
): Promise<Invoice[]> => {
  return prisma.invoice.findMany({
    where: { bookingId },
    orderBy: { issuedAt: "desc" },
  });
};

/**
 * Find invoice by document number
 */
export const findInvoiceByNumber = async (
  invoiceNumber: string,
): Promise<Invoice | null> => {
  return prisma.invoice.findUnique({
    where: { invoiceNumber },
    include: {
      booking: true,
      payment: true,
    },
  });
};

/**
 * Create invoice record atomically inside transaction or standalone
 */
export const createInvoice = async (
  client: PrismaTx | typeof prisma,
  params: CreateInvoiceParams,
): Promise<Invoice> => {
  const invoiceNumber = await generateUniqueInvoiceNumber(client, params.type || "PAYMENT_RECEIPT");

  return client.invoice.create({
    data: {
      invoiceNumber,
      bookingId: params.bookingId,
      paymentId: params.paymentId ?? null,
      type: params.type || "PAYMENT_RECEIPT",
      status: params.status || "ISSUED",
      currency: params.currency,
      subtotalAmount: params.subtotalAmount,
      discountAmount: params.discountAmount ?? 0,
      taxAmount: params.taxAmount ?? 0,
      totalAmount: params.totalAmount,
      paidAmount: params.paidAmount,
      dueAmount: params.dueAmount ?? 0,
      issuedAt: params.issuedAt ?? new Date(),
      pdfUrl: params.pdfUrl ?? null,
      metadata: params.metadata ?? null,
    },
  });
};
