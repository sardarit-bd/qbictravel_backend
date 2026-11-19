import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../../../../lib/prisma.js";
import { generateFinancialPdfBuffer, type PdfDocumentData } from "../../pdfService.js";
import * as invoiceRepository from "../../invoiceRepository.js";
import * as invoiceService from "../../invoiceService.js";
import * as notificationService from "../../../notification/notificationService.js";
import * as notificationRepository from "../../../notification/notificationRepository.js";
import * as mailer from "../../../../shared/utils/mailer.js";
import { getCompanyDetails } from "../../companyConfig.js";

describe("Phase 5: PDF Invoice & Payment Receipt Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. PDF Generation & Standards", () => {
    it("generates a valid binary PDF-1.4 buffer with Helvetica typography and PhuketTours header", () => {
      const data: PdfDocumentData = {
        title: "PAYMENT RECEIPT",
        documentNumber: "PT-REC-202611-0001",
        issueDate: "2026-11-19",
        bookingReference: "BK-TEST1234",
        serviceName: "Phi Phi Luxury Day Tour",
        travelDate: "2026-12-01",
        customerName: "John Doe",
        customerEmail: "john@example.com",
        paymentMethod: "STRIPE",
        paymentDate: "2026-11-19",
        currency: "THB",
        subtotal: 5000,
        discount: 500,
        tax: 0,
        amountPaid: 4500,
        dueAmount: 0,
        company: {
          name: "PhuketTours Co., Ltd.",
          address: "123 Patong Road",
          email: "billing@phukettours.com",
          phone: "+66 76 000 000",
          registrationNumber: "0835560001234",
          taxId: "0835560001234",
        },
      };

      const buffer = generateFinancialPdfBuffer(data);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(500);

      const header = buffer.subarray(0, 8).toString("latin1");
      expect(header).toBe("%PDF-1.4");

      const content = buffer.toString("latin1");
      expect(content).toContain("PAYMENT RECEIPT");
      expect(content).toContain("PT-REC-202611-0001");
      expect(content).toContain("Phi Phi Luxury Day Tour");
      expect(content).toContain("4500.00");
      expect(content).toContain("%%EOF");
    });

    it("handles missing company registration or tax IDs gracefully with placeholders/empty fields", () => {
      const company = getCompanyDetails();
      expect(company.name).toBeDefined();
      expect(company.email).toBeDefined();

      const data: PdfDocumentData = {
        title: "PAYMENT RECEIPT",
        documentNumber: "PT-REC-202611-0002",
        issueDate: "2026-11-19",
        bookingReference: "BK-NO-TAX",
        serviceName: "James Bond Island Cruise",
        customerName: "Jane Smith",
        customerEmail: "jane@example.com",
        currency: "USD",
        subtotal: 100,
        discount: 0,
        tax: 0,
        amountPaid: 100,
        dueAmount: 0,
        company: {
          name: "PhuketTours",
          address: "Phuket, Thailand",
          email: "support@phukettours.com",
          phone: "+66 76 111 222",
          registrationNumber: null,
          taxId: null,
        },
      };

      const buffer = generateFinancialPdfBuffer(data);
      const text = buffer.toString("latin1");
      expect(text).not.toContain("Tax ID: undefined");
      expect(text).not.toContain("Reg No: undefined");
      expect(text).toContain("James Bond Island Cruise");
    });
  });

  describe("2. Unique Monotonic Invoice Numbering & Database Uniqueness", () => {
    it("generates formatted sequence numbers for the current month", async () => {
      const mockClient = {
        invoice: {
          count: vi.fn().mockResolvedValue(5),
          findUnique: vi.fn().mockResolvedValue(null),
        },
      };

      const num = await invoiceRepository.generateUniqueInvoiceNumber(mockClient as any, "PAYMENT_RECEIPT");
      const currentYearMonth = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}`;
      expect(num).toBe(`PT-REC-${currentYearMonth}-0006`);
    });

    it("safely advances sequence on collision during concurrent generation", async () => {
      const currentYearMonth = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}`;
      const mockClient = {
        invoice: {
          count: vi.fn().mockResolvedValue(0),
          findUnique: vi
            .fn()
            .mockResolvedValueOnce({ id: "inv-existing" }) // first attempt collides
            .mockResolvedValueOnce(null), // second attempt succeeds
        },
      };

      const num = await invoiceRepository.generateUniqueInvoiceNumber(mockClient as any, "TAX_INVOICE");
      expect(num).toBe(`PT-TAX-${currentYearMonth}-0002`);
    });
  });

  describe("3. Idempotent Invoice & Payment Receipt Creation", () => {
    it("returns existing payment receipt without duplicating when invoice already issued for paymentId", async () => {
      const mockExisting = {
        id: "inv-existing-1",
        invoiceNumber: "PT-REC-202611-0001",
        bookingId: "b-1",
        paymentId: "p-1",
        type: "PAYMENT_RECEIPT",
        status: "ISSUED",
        currency: "THB",
        subtotalAmount: 2000,
        discountAmount: 0,
        taxAmount: 0,
        totalAmount: 2000,
        paidAmount: 2000,
        dueAmount: 0,
        issuedAt: new Date(),
        booking: {
          id: "b-1",
          isGuest: false,
          service: { name: "Phi Phi Tour" },
          customer: { name: "Alice", email: "alice@example.com" },
          guestSnapshot: null,
          availability: null,
        },
        payment: { method: "STRIPE", createdAt: new Date() },
      };

      vi.spyOn(prisma.invoice, "findFirst").mockResolvedValue(mockExisting as any);
      vi.spyOn(prisma.invoice, "findUnique").mockResolvedValue(mockExisting as any);
      const createSpy = vi.spyOn(prisma.invoice, "create");

      const result = await invoiceService.getOrCreatePaymentReceipt("b-1", "p-1");

      expect(result.invoice.id).toBe("inv-existing-1");
      expect(result.filename).toBe("PT-REC-202611-0001.pdf");
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("creates a new payment receipt with correct financial math and guest snapshot", async () => {
      const mockBooking = {
        id: "b-guest-1",
        isGuest: true,
        currency: "THB",
        basePrice: 6000,
        finalPrice: 5000, // 1000 discount
        service: { name: "Similan Islands Full Day" },
        customer: { id: "shadow-1", name: "Shadow Cust", email: "guest@example.com" },
        guestSnapshot: { guestName: "Bob The Guest", guestEmail: "bob.guest@example.com" },
        availability: { date: new Date("2026-12-15") },
        payments: [
          { id: "p-guest-1", amount: 5000, currency: "THB", method: "STRIPE", status: "VERIFIED", createdAt: new Date() },
        ],
      };

      const mockCreatedInvoice = {
        id: "inv-new-guest",
        invoiceNumber: "PT-REC-202611-0099",
        bookingId: "b-guest-1",
        paymentId: "p-guest-1",
        type: "PAYMENT_RECEIPT",
        status: "ISSUED",
        currency: "THB",
        subtotalAmount: 6000,
        discountAmount: 1000,
        taxAmount: 0,
        totalAmount: 5000,
        paidAmount: 5000,
        dueAmount: 0,
        issuedAt: new Date(),
        booking: mockBooking,
        payment: mockBooking.payments[0],
      };

      vi.spyOn(prisma.invoice, "findFirst").mockResolvedValue(null);
      vi.spyOn(prisma.booking, "findUnique").mockResolvedValue(mockBooking as any);
      vi.spyOn(prisma.invoice, "count").mockResolvedValue(98);
      vi.spyOn(prisma.invoice, "create").mockResolvedValue(mockCreatedInvoice as any);
      vi.spyOn(prisma.invoice, "findUnique").mockResolvedValue(mockCreatedInvoice as any);

      const result = await invoiceService.getOrCreatePaymentReceipt("b-guest-1", "p-guest-1");

      expect(result.invoice.invoiceNumber).toBe("PT-REC-202611-0099");
      expect(result.pdfBuffer).toBeDefined();

      const pdfText = result.pdfBuffer.toString("latin1");
      expect(pdfText).toContain("Bob The Guest");
      expect(pdfText).toContain("bob.guest@example.com");
      expect(pdfText).not.toContain("Shadow Cust");
    });

    it("handles partial payments and displays balance due on the document", async () => {
      const mockBooking = {
        id: "b-partial-1",
        isGuest: false,
        currency: "USD",
        basePrice: 1000,
        finalPrice: 1000,
        service: { name: "City Tour" },
        customer: { id: "c-1", name: "Charlie", email: "charlie@example.com" },
        guestSnapshot: null,
        availability: null,
        payments: [
          { id: "p-part-1", amount: 400, currency: "USD", method: "PAYPAL", status: "VERIFIED", createdAt: new Date() },
        ],
      };

      const mockCreatedInvoice = {
        id: "inv-partial-1",
        invoiceNumber: "PT-REC-202611-0100",
        bookingId: "b-partial-1",
        paymentId: "p-part-1",
        type: "PAYMENT_RECEIPT",
        status: "ISSUED",
        currency: "USD",
        subtotalAmount: 1000,
        discountAmount: 0,
        taxAmount: 0,
        totalAmount: 1000,
        paidAmount: 400,
        dueAmount: 600,
        issuedAt: new Date(),
        booking: mockBooking,
        payment: mockBooking.payments[0],
      };

      vi.spyOn(prisma.invoice, "findFirst").mockResolvedValue(null);
      vi.spyOn(prisma.booking, "findUnique").mockResolvedValue(mockBooking as any);
      vi.spyOn(prisma.invoice, "count").mockResolvedValue(99);
      vi.spyOn(prisma.invoice, "create").mockResolvedValue(mockCreatedInvoice as any);
      vi.spyOn(prisma.invoice, "findUnique").mockResolvedValue(mockCreatedInvoice as any);

      const result = await invoiceService.getOrCreatePaymentReceipt("b-partial-1", "p-part-1");

      const pdfText = result.pdfBuffer.toString("latin1");
      expect(pdfText).toContain("Amount Paid:");
      expect(pdfText).toContain("400.00");
      expect(pdfText).toContain("Balance Due:");
      expect(pdfText).toContain("600.00");
    });
  });

  describe("4. Email Attachment Integration & Failure Safety", () => {
    it("attaches generated PDF receipt to payment confirmation email", async () => {
      const mockBooking = {
        id: "b-email-1",
        status: "CONFIRMED",
        paymentStatus: "PAID",
        fulfillmentStatus: "NOT_ASSIGNED",
        isGuest: false,
        service: { name: "Phi Phi Island Day Trip" },
        customer: { id: "c-1", name: "David", email: "david@example.com", status: "active" },
        agent: null,
        guestSnapshot: null,
      };

      vi.spyOn(notificationRepository, "findSetting").mockResolvedValue({ enabled: true } as any);
      vi.spyOn(notificationRepository, "findBookingRecipients").mockResolvedValue(mockBooking as any);

      const fakeReceiptBuffer = Buffer.from("%PDF-1.4\nfake content\n%%EOF");
      vi.spyOn(invoiceService, "getOrCreatePaymentReceipt").mockResolvedValue({
        invoice: { id: "inv-david", invoiceNumber: "PT-REC-202611-0050" } as any,
        pdfBuffer: fakeReceiptBuffer,
        filename: "PT-REC-202611-0050.pdf",
      });

      const sendEmailSpy = vi.spyOn(mailer, "sendEmail").mockResolvedValue(undefined as any);

      await notificationService.notifyPaymentDecision("b-email-1", "CONFIRMED", "p-david-1");

      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "david@example.com",
          subject: "Your payment has been confirmed",
          attachments: [
            {
              filename: "PT-REC-202611-0050.pdf",
              content: fakeReceiptBuffer,
              contentType: "application/pdf",
            },
          ],
        }),
      );
    });

    it("succeeds with email delivery even if PDF receipt generation fails", async () => {
      const mockBooking = {
        id: "b-email-fail-pdf",
        status: "CONFIRMED",
        paymentStatus: "PAID",
        fulfillmentStatus: "NOT_ASSIGNED",
        isGuest: false,
        service: { name: "City Tour" },
        customer: { id: "c-1", name: "Eve", email: "eve@example.com", status: "active" },
        agent: null,
        guestSnapshot: null,
      };

      vi.spyOn(notificationRepository, "findSetting").mockResolvedValue({ enabled: true } as any);
      vi.spyOn(notificationRepository, "findBookingRecipients").mockResolvedValue(mockBooking as any);
      vi.spyOn(invoiceService, "getOrCreatePaymentReceipt").mockRejectedValue(new Error("PDF Engine Error"));
      const sendEmailSpy = vi.spyOn(mailer, "sendEmail").mockResolvedValue(undefined as any);

      await notificationService.notifyPaymentDecision("b-email-fail-pdf", "CONFIRMED", "p-eve-1");

      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      expect(sendEmailSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "eve@example.com",
          attachments: undefined,
        }),
      );
    });
  });
});
