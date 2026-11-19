/**
 * Pure Node.js Standard PDF-1.4 Generator for Financial Documents.
 * Zero external binary or npm dependencies.
 * Creates valid PDF documents with standard Helvetica fonts, tables, margins, and headers.
 */

export interface PdfDocumentData {
  title: string; // e.g. "PAYMENT RECEIPT" or "TAX INVOICE"
  documentNumber: string; // e.g. "PT-REC-202611-0001"
  issueDate: string; // e.g. "2026-11-19"
  bookingReference: string; // e.g. "BK-9E74C5"
  serviceName: string; // e.g. "Phi Phi Island Luxury Day Tour"
  travelDate?: string | null;
  customerName: string;
  customerEmail: string;
  paymentMethod?: string;
  paymentDate?: string;
  currency: string;
  subtotal: number;
  discount: number;
  tax: number;
  amountPaid: number;
  dueAmount: number;
  refundAmount?: number;
  company: {
    name: string;
    address: string;
    email: string;
    phone: string;
    registrationNumber: string | null;
    taxId: string | null;
  };
}

const escapePdfText = (text: string): string => {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
};

export const generateFinancialPdfBuffer = (data: PdfDocumentData): Buffer => {
  const contentCommands: string[] = [];

  // Helper to draw text
  const addText = (
    text: string,
    x: number,
    y: number,
    font = "/F1",
    size = 10,
    color = "0 0 0",
  ) => {
    contentCommands.push(
      `${color} rg BT ${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escapePdfText(text)}) Tj ET`,
    );
  };

  // Helper to draw horizontal line
  const addLine = (x1: number, y1: number, x2: number, y2: number, lineWidth = 0.5, color = "0.8 0.8 0.8") => {
    contentCommands.push(
      `${color} RG ${lineWidth} w ${x1} ${y1} m ${x2} ${y2} l S`,
    );
  };

  // Helper to draw rectangle (filled or stroked)
  const addRect = (x: number, y: number, w: number, h: number, fillColor = "0.95 0.95 0.95") => {
    contentCommands.push(
      `${fillColor} rg ${x} ${y} ${w} ${h} re f`,
    );
  };

  // Page dimensions: A4 is 595.28 x 841.89 points
  // Margins: Left 50, Right 545, Top 790, Bottom 50
  const left = 50;
  const right = 545;

  // 1. Header / Branding
  addText(data.company.name.toUpperCase(), left, 780, "/F2", 18, "0.1 0.3 0.6");
  addText(data.title.toUpperCase(), right - (data.title.length * 8.5), 780, "/F2", 16, "0.2 0.2 0.2");

  // Company contact details (left)
  addText(data.company.address, left, 762, "/F1", 9, "0.4 0.4 0.4");
  addText(`Email: ${data.company.email} | Phone: ${data.company.phone}`, left, 750, "/F1", 9, "0.4 0.4 0.4");
  if (data.company.taxId || data.company.registrationNumber) {
    const regParts: string[] = [];
    if (data.company.registrationNumber) regParts.push(`Reg No: ${data.company.registrationNumber}`);
    if (data.company.taxId) regParts.push(`Tax ID: ${data.company.taxId}`);
    addText(regParts.join(" | "), left, 738, "/F1", 8.5, "0.5 0.5 0.5");
  }

  // Document meta (right)
  addText(`Doc Number: ${data.documentNumber}`, right - 180, 762, "/F2", 9.5, "0.2 0.2 0.2");
  addText(`Issue Date: ${data.issueDate}`, right - 180, 750, "/F1", 9, "0.4 0.4 0.4");
  addText(`Booking Ref: ${data.bookingReference}`, right - 180, 738, "/F2", 9, "0.1 0.3 0.6");

  addLine(left, 725, right, 725, 1, "0.8 0.8 0.8");

  // 2. Bill To & Payment Info Box
  addRect(left, 650, right - left, 65, "0.96 0.97 0.98");
  addLine(left, 650, right, 650, 0.5, "0.85 0.85 0.85");
  addLine(left, 715, right, 715, 0.5, "0.85 0.85 0.85");

  addText("BILLED TO / PASSENGER", left + 15, 698, "/F2", 9, "0.3 0.3 0.3");
  addText(`Name: ${data.customerName}`, left + 15, 682, "/F2", 10, "0.1 0.1 0.1");
  addText(`Email: ${data.customerEmail}`, left + 15, 668, "/F1", 9, "0.3 0.3 0.3");

  addText("PAYMENT DETAILS", 340, 698, "/F2", 9, "0.3 0.3 0.3");
  addText(`Method: ${data.paymentMethod || "VERIFIED PAYMENT"}`, 340, 682, "/F1", 9.5, "0.1 0.1 0.1");
  addText(`Payment Date: ${data.paymentDate || data.issueDate}`, 340, 668, "/F1", 9, "0.3 0.3 0.3");

  // 3. Service / Tour Items Table
  let currentY = 615;
  addRect(left, currentY - 5, right - left, 22, "0.9 0.93 0.96");
  addText("DESCRIPTION", left + 10, currentY + 3, "/F2", 9, "0.1 0.2 0.4");
  addText("TRAVEL DATE", 320, currentY + 3, "/F2", 9, "0.1 0.2 0.4");
  addText("AMOUNT", right - 65, currentY + 3, "/F2", 9, "0.1 0.2 0.4");

  currentY -= 30;
  addText(data.serviceName, left + 10, currentY, "/F2", 10, "0.1 0.1 0.1");
  addText(data.travelDate || "Confirmed Schedule", 320, currentY, "/F1", 9, "0.3 0.3 0.3");
  const subtotalFormatted = `${data.currency} ${data.subtotal.toFixed(2)}`;
  addText(subtotalFormatted, right - (subtotalFormatted.length * 6), currentY, "/F2", 10, "0.1 0.1 0.1");

  currentY -= 20;
  addLine(left, currentY + 10, right, currentY + 10, 0.5, "0.85 0.85 0.85");

  // 4. Financial Summary
  const summaryX = 350;
  const valX = right;

  currentY -= 15;
  addText("Subtotal:", summaryX, currentY, "/F1", 9.5, "0.3 0.3 0.3");
  const stText = `${data.currency} ${data.subtotal.toFixed(2)}`;
  addText(stText, valX - (stText.length * 5.8), currentY, "/F1", 9.5, "0.2 0.2 0.2");

  if (data.discount > 0) {
    currentY -= 16;
    addText("Discount Applied:", summaryX, currentY, "/F1", 9.5, "0.1 0.6 0.2");
    const discText = `-${data.currency} ${data.discount.toFixed(2)}`;
    addText(discText, valX - (discText.length * 5.8), currentY, "/F1", 9.5, "0.1 0.6 0.2");
  }

  if (data.tax > 0) {
    currentY -= 16;
    addText("Tax / VAT:", summaryX, currentY, "/F1", 9.5, "0.3 0.3 0.3");
    const taxText = `${data.currency} ${data.tax.toFixed(2)}`;
    addText(taxText, valX - (taxText.length * 5.8), currentY, "/F1", 9.5, "0.2 0.2 0.2");
  }

  currentY -= 18;
  addLine(summaryX, currentY + 12, valX, currentY + 12, 0.5, "0.7 0.7 0.7");

  addText("Total Amount:", summaryX, currentY, "/F2", 10, "0.1 0.1 0.1");
  const totalText = `${data.currency} ${(data.subtotal - data.discount + data.tax).toFixed(2)}`;
  addText(totalText, valX - (totalText.length * 6.5), currentY, "/F2", 10.5, "0.1 0.1 0.1");

  currentY -= 20;
  addRect(summaryX - 5, currentY - 5, (valX - summaryX) + 10, 24, "0.92 0.97 0.92");
  addText("Amount Paid:", summaryX + 5, currentY + 2, "/F2", 10, "0.05 0.5 0.1");
  const paidText = `${data.currency} ${data.amountPaid.toFixed(2)}`;
  addText(paidText, valX - (paidText.length * 6.8), currentY + 2, "/F2", 10.5, "0.05 0.5 0.1");

  if (data.dueAmount > 0) {
    currentY -= 20;
    addText("Balance Due:", summaryX + 5, currentY, "/F2", 9.5, "0.8 0.2 0.1");
    const dueText = `${data.currency} ${data.dueAmount.toFixed(2)}`;
    addText(dueText, valX - (dueText.length * 6.2), currentY, "/F2", 9.5, "0.8 0.2 0.1");
  }

  if (data.refundAmount && data.refundAmount > 0) {
    currentY -= 20;
    addText("Refunded Amount:", summaryX + 5, currentY, "/F2", 9.5, "0.8 0.2 0.1");
    const refText = `-${data.currency} ${data.refundAmount.toFixed(2)}`;
    addText(refText, valX - (refText.length * 6.2), currentY, "/F2", 9.5, "0.8 0.2 0.1");
  }

  // 5. Footer & Notes
  addLine(left, 100, right, 100, 0.5, "0.8 0.8 0.8");
  addText("Thank you for choosing PhuketTours. We wish you an unforgettable adventure!", left, 85, "/F2", 9, "0.1 0.3 0.6");
  addText(
    "This is an electronically generated official document. No physical signature is required.",
    left,
    72,
    "/F1",
    8,
    "0.5 0.5 0.5",
  );
  addText(
    `For customer support and itinerary changes, please visit ${data.company.email}`,
    left,
    60,
    "/F1",
    8,
    "0.5 0.5 0.5",
  );

  // Compile PDF Objects
  const streamData = contentCommands.join("\n");
  const streamLen = Buffer.byteLength(streamData, "latin1");

  const obj1 = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj";
  const obj2 = "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj";
  const obj3 =
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj";
  const obj4 = "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj";
  const obj5 = "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj";
  const obj6 = `6 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamData}\nendstream\nendobj`;

  const body = [obj1, obj2, obj3, obj4, obj5, obj6];
  let offset = 9; // %PDF-1.4\n
  const xref = ["0000000000 65535 f \n"];

  for (const o of body) {
    xref.push(String(offset).padStart(10, "0") + " 00000 n \n");
    offset += Buffer.byteLength(o, "latin1") + 1; // + newline
  }

  const xrefOffset = offset;
  const pdfString =
    "%PDF-1.4\n" +
    body.join("\n") +
    "\nxref\n0 " +
    (body.length + 1) +
    "\n" +
    xref.join("") +
    "trailer\n<< /Size " +
    (body.length + 1) +
    " /Root 1 0 R >>\nstartxref\n" +
    xrefOffset +
    "\n%%EOF\n";

  return Buffer.from(pdfString, "latin1");
};
