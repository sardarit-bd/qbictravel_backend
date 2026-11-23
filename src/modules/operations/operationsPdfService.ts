/**
 * Operations PDF Generator for Tour Schedules and Daily Manifests.
 * Built with pure Node.js Standard PDF-1.4 specifications.
 * Zero external binary or npm dependencies.
 * Produces crisp, landscape A4 tabular PDFs with PhuketTours branding.
 * Fully supports multi-page pagination, repeated table headers, and footers.
 */

export interface CompanyContactInfo {
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
}

export interface SchedulePdfTourRow {
  travelDate: string;
  serviceTitle: string;
  departureTime: string;
  totalBookings: number;
  totalPassengers: number;
  adults: number;
  children: number;
  infants: number;
  pickupSummaryText: string;
  operationalStatus: string;
}

export interface SchedulePdfData {
  title: string; // "TOUR SCHEDULE"
  dateRangeText: string; // e.g. "2026-11-01 to 2026-11-30"
  generatedAt: string; // e.g. "2026-11-23 10:45 AM"
  totalTours: number;
  totalBookings: number;
  totalPassengers: number;
  company: CompanyContactInfo;
  rows: SchedulePdfTourRow[];
}

export interface ManifestPdfGuestRow {
  index: number;
  bookingRef: string;
  guestName: string;
  phone: string;
  email: string;
  guestsText: string;
  breakdownText: string;
  pickupLocation: string;
}

export interface ManifestTourSection {
  serviceTitle: string;
  travelDate: string;
  departureTime: string; // e.g. "08:30 AM" or "Not provided"
  totalBookings: number;
  totalGuests: number;
  adults: number;
  children: number;
  infants: number;
  guests: ManifestPdfGuestRow[];
}

export interface UnifiedManifestPdfData {
  title: string; // "DAILY TOUR MANIFEST"
  subtitle?: string; // "Guest List & Pickup Information"
  dateRangeText?: string;
  generatedAt: string;
  company: CompanyContactInfo;
  sections: ManifestTourSection[];
}

// Backward-compatible alias for single-tour invocation
export type ManifestPdfData = ManifestTourSection & {
  title?: string;
  subtitle?: string;
  generatedAt: string;
  company: CompanyContactInfo;
};

const escapePdfText = (text: string | null | undefined): string => {
  if (!text) return "";
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\r\n\t]/g, " ");
};

// Truncate or fit string within approximate character length
const truncateText = (text: string, maxLength: number): string => {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 2) + "..";
};

// Draw text command
const textCmd = (
  text: string,
  x: number,
  y: number,
  font = "/F1",
  size = 9,
  color = "0 0 0"
): string => {
  return `${color} rg BT ${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escapePdfText(text)}) Tj ET`;
};

// Draw line command
const lineCmd = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  lineWidth = 0.5,
  color = "0.85 0.88 0.90"
): string => {
  return `${color} RG ${lineWidth} w ${x1} ${y1} m ${x2} ${y2} l S`;
};

// Draw rectangle command
const rectCmd = (
  x: number,
  y: number,
  w: number,
  h: number,
  fillColor = "0.96 0.97 0.98"
): string => {
  return `${fillColor} rg ${x} ${y} ${w} ${h} re f`;
};

/**
 * Builds a multi-page PDF buffer from page content commands array.
 * A4 Landscape: Width = 841.89 points, Height = 595.28 points.
 */
const buildLandscapePdfDocument = (pageCommands: string[][]): Buffer => {
  const pageCount = pageCommands.length;
  const pdfObjects: string[] = [];

  // Object 1: Catalog
  pdfObjects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");

  // Page Object Numbers: 3, 4, ... 2 + pageCount
  // Font Objects: 3 + pageCount, 4 + pageCount
  // Content Stream Objects: (5 + pageCount) to (4 + 2 * pageCount)
  const font1ObjNum = 3 + pageCount;
  const font2ObjNum = 4 + pageCount;

  const pageKidsRefs: string[] = [];
  for (let i = 0; i < pageCount; i++) {
    const pageObjNum = 3 + i;
    pageKidsRefs.push(`${pageObjNum} 0 R`);
  }

  // Object 2: Pages container
  pdfObjects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageKidsRefs.join(" ")}] /Count ${pageCount} >>\nendobj`
  );

  // Page Objects
  for (let i = 0; i < pageCount; i++) {
    const pageObjNum = 3 + i;
    const contentObjNum = 5 + pageCount + i;
    pdfObjects.push(
      `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 841.89 595.28] /Resources << /Font << /F1 ${font1ObjNum} 0 R /F2 ${font2ObjNum} 0 R >> >> /Contents ${contentObjNum} 0 R >>\nendobj`
    );
  }

  // Font Objects
  pdfObjects.push(
    `${font1ObjNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`
  );
  pdfObjects.push(
    `${font2ObjNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj`
  );

  // Content Streams
  for (let i = 0; i < pageCount; i++) {
    const contentObjNum = 5 + pageCount + i;
    const stream = pageCommands[i].join("\n");
    const len = Buffer.byteLength(stream, "latin1");
    pdfObjects.push(
      `${contentObjNum} 0 obj\n<< /Length ${len} >>\nstream\n${stream}\nendstream\nendobj`
    );
  }

  // Compile xref and trailer
  let offset = 9; // %PDF-1.4\n
  const xref: string[] = ["0000000000 65535 f \n"];

  for (const obj of pdfObjects) {
    xref.push(String(offset).padStart(10, "0") + " 00000 n \n");
    offset += Buffer.byteLength(obj, "latin1") + 1; // + newline
  }

  const xrefOffset = offset;
  const pdfString =
    "%PDF-1.4\n" +
    pdfObjects.join("\n") +
    "\nxref\n0 " +
    (pdfObjects.length + 1) +
    "\n" +
    xref.join("") +
    "trailer\n<< /Size " +
    (pdfObjects.length + 1) +
    " /Root 1 0 R >>\nstartxref\n" +
    xrefOffset +
    "\n%%EOF\n";

  return Buffer.from(pdfString, "latin1");
};

/**
 * 1. Generates Professional Tour Schedule PDF Buffer (Landscape A4).
 */
export const generateTourSchedulePdfBuffer = (data: SchedulePdfData): Buffer => {
  // Page Geometry (A4 Landscape)
  const pageWidth = 841.89;
  const pageHeight = 595.28;
  const marginX = 40;
  const contentWidth = pageWidth - marginX * 2; // 761.89 pt

  // Colors
  const tealPrimary = "0.09 0.40 0.47"; // #176779
  const textDark = "0.10 0.16 0.17"; // #18282A
  const textMuted = "0.45 0.50 0.54"; // #74818A
  const borderLight = "0.90 0.92 0.93"; // #E5EAED
  const rowAltBg = "0.98 0.99 0.99";

  // Table Column Definitions
  // Total width: 761.89 pt
  const colWidths = {
    date: 75,
    tour: 180,
    time: 80,
    bks: 70,
    guests: 180,
    pickup: 105,
    status: 71.89,
  };

  const colX = {
    date: marginX,
    tour: marginX + colWidths.date,
    time: marginX + colWidths.date + colWidths.tour,
    bks: marginX + colWidths.date + colWidths.tour + colWidths.time,
    guests: marginX + colWidths.date + colWidths.tour + colWidths.time + colWidths.bks,
    pickup:
      marginX +
      colWidths.date +
      colWidths.tour +
      colWidths.time +
      colWidths.bks +
      colWidths.guests,
    status:
      marginX +
      colWidths.date +
      colWidths.tour +
      colWidths.time +
      colWidths.bks +
      colWidths.guests +
      colWidths.pickup,
  };

  const rowsPerPage = 14;
  const totalRows = data.rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / rowsPerPage));
  const pages: string[][] = [];

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const cmds: string[] = [];
    const pageNum = pageIdx + 1;

    // Header Top: Brand & Title
    cmds.push(textCmd("PHUKETTOURS", marginX, 555, "/F2", 18, tealPrimary));
    cmds.push(textCmd("TOUR SCHEDULE", marginX + 150, 555, "/F2", 14, textDark));
    cmds.push(textCmd(`Date Range: ${data.dateRangeText}`, marginX + 150, 540, "/F1", 9, textMuted));

    // Company Contact Information (top right)
    let contactLine = "";
    if (data.company.email) contactLine += `Email: ${data.company.email}`;
    if (data.company.phone) contactLine += (contactLine ? "  |  " : "") + `Phone: ${data.company.phone}`;
    if (data.company.website) contactLine += (contactLine ? "  |  " : "") + `${data.company.website}`;

    if (contactLine) {
      cmds.push(textCmd(contactLine, marginX, 526, "/F1", 8.5, textMuted));
    }

    // Top Right KPI Summary Box
    const kpiBoxW = 260;
    const kpiBoxX = pageWidth - marginX - kpiBoxW;
    cmds.push(rectCmd(kpiBoxX, 520, kpiBoxW, 45, "0.95 0.97 0.98"));
    cmds.push(lineCmd(kpiBoxX, 520, kpiBoxX + kpiBoxW, 520, 0.5, borderLight));
    cmds.push(lineCmd(kpiBoxX, 565, kpiBoxX + kpiBoxW, 565, 0.5, borderLight));

    cmds.push(textCmd(`Total Tours: ${data.totalTours}`, kpiBoxX + 12, 548, "/F2", 9.5, tealPrimary));
    cmds.push(textCmd(`Total Reservations: ${data.totalBookings}`, kpiBoxX + 12, 534, "/F1", 9, textDark));
    cmds.push(textCmd(`Total Guests: ${data.totalPassengers}`, kpiBoxX + 140, 548, "/F2", 9.5, tealPrimary));
    cmds.push(textCmd(`Generated: ${data.generatedAt}`, kpiBoxX + 12, 510, "/F1", 8, textMuted));

    // Top Separator
    cmds.push(lineCmd(marginX, 502, marginX + contentWidth, 502, 1, tealPrimary));

    // Table Header Row
    const thY = 482;
    cmds.push(rectCmd(marginX, thY - 5, contentWidth, 20, "0.92 0.95 0.96"));
    cmds.push(lineCmd(marginX, thY - 5, marginX + contentWidth, thY - 5, 0.5, borderLight));
    cmds.push(lineCmd(marginX, thY + 15, marginX + contentWidth, thY + 15, 0.5, borderLight));

    cmds.push(textCmd("DATE", colX.date + 6, thY + 1, "/F2", 8.5, tealPrimary));
    cmds.push(textCmd("TOUR / ACTIVITY", colX.tour + 6, thY + 1, "/F2", 8.5, tealPrimary));
    cmds.push(textCmd("DEPARTURE", colX.time + 6, thY + 1, "/F2", 8.5, tealPrimary));
    cmds.push(textCmd("BOOKINGS", colX.bks + 6, thY + 1, "/F2", 8.5, tealPrimary));
    cmds.push(textCmd("GUESTS / PASSENGERS", colX.guests + 6, thY + 1, "/F2", 8.5, tealPrimary));
    cmds.push(textCmd("PICKUP / TRANSPORT", colX.pickup + 6, thY + 1, "/F2", 8.5, tealPrimary));
    cmds.push(textCmd("STATUS", colX.status + 6, thY + 1, "/F2", 8.5, tealPrimary));

    // Table Body Rows
    const startIndex = pageIdx * rowsPerPage;
    const pageRows = data.rows.slice(startIndex, startIndex + rowsPerPage);

    let rowY = 458;
    const rowHeight = 26;

    if (pageRows.length === 0) {
      cmds.push(rectCmd(marginX, rowY - 10, contentWidth, 40, "0.99 0.99 0.99"));
      cmds.push(
        textCmd(
          "No operational departures scheduled for this date range.",
          marginX + 20,
          rowY + 6,
          "/F1",
          9.5,
          textMuted
        )
      );
    } else {
      pageRows.forEach((row, rIdx) => {
        const bg = rIdx % 2 === 0 ? "1 1 1" : rowAltBg;
        cmds.push(rectCmd(marginX, rowY - 6, contentWidth, rowHeight, bg));
        cmds.push(lineCmd(marginX, rowY - 6, marginX + contentWidth, rowY - 6, 0.5, borderLight));

        // Date
        cmds.push(textCmd(row.travelDate, colX.date + 6, rowY + 3, "/F1", 8.5, textDark));

        // Tour Title
        cmds.push(
          textCmd(truncateText(row.serviceTitle, 32), colX.tour + 6, rowY + 3, "/F2", 8.5, textDark)
        );

        // Departure Time
        cmds.push(textCmd(row.departureTime, colX.time + 6, rowY + 3, "/F1", 8.5, textDark));

        // Bookings
        cmds.push(
          textCmd(`${row.totalBookings} bks`, colX.bks + 6, rowY + 3, "/F1", 8.5, textDark)
        );

        // Guests breakdown: "15 Guests (8A, 7C, 0I)"
        const guestSummary = `${row.totalPassengers} Guests (${row.adults}A, ${row.children}C, ${row.infants}I)`;
        cmds.push(textCmd(truncateText(guestSummary, 34), colX.guests + 6, rowY + 3, "/F1", 8.5, tealPrimary));

        // Pickup / Transport
        cmds.push(
          textCmd(truncateText(row.pickupSummaryText, 20), colX.pickup + 6, rowY + 3, "/F1", 8, textDark)
        );

        // Status
        const stColor =
          row.operationalStatus === "FULFILLED"
            ? "0.08 0.50 0.35"
            : row.operationalStatus === "IN_PROGRESS"
            ? "0.09 0.40 0.65"
            : "0.40 0.45 0.50";
        cmds.push(
          textCmd(row.operationalStatus.replace("_", " "), colX.status + 6, rowY + 3, "/F2", 7.5, stColor)
        );

        rowY -= rowHeight;
      });
    }

    // Outer table bounding box
    cmds.push(lineCmd(marginX, rowY - 6, marginX + contentWidth, rowY - 6, 0.5, borderLight));
    cmds.push(lineCmd(marginX, thY + 15, marginX, rowY - 6, 0.5, borderLight));
    cmds.push(lineCmd(marginX + contentWidth, thY + 15, marginX + contentWidth, rowY - 6, 0.5, borderLight));

    // Page Footer
    const footerY = 28;
    cmds.push(lineCmd(marginX, footerY + 12, marginX + contentWidth, footerY + 12, 0.5, borderLight));
    cmds.push(
      textCmd(
        "PhuketTours Operations Management System — Official Operational Schedule Document",
        marginX,
        footerY,
        "/F1",
        8,
        textMuted
      )
    );
    cmds.push(
      textCmd(
        `Page ${pageNum} of ${totalPages}`,
        pageWidth - marginX - 60,
        footerY,
        "/F2",
        8,
        tealPrimary
      )
    );

    pages.push(cmds);
  }

  return buildLandscapePdfDocument(pages);
};

/**
 * 2. Generates Professional Daily Tour Manifest PDF Buffer (Landscape A4).
 * Supports both Unified Multi-Tour / Multi-Date documents and Single-Tour documents.
 */
export const generateDailyManifestPdfBuffer = (
  input: UnifiedManifestPdfData | ManifestPdfData
): Buffer => {
  // Normalize input to UnifiedManifestPdfData with sections
  const data: UnifiedManifestPdfData =
    "sections" in input && Array.isArray((input as UnifiedManifestPdfData).sections)
      ? (input as UnifiedManifestPdfData)
      : {
          title: input.title || "DAILY TOUR MANIFEST",
          subtitle: input.subtitle || "Guest List & Pickup Information",
          generatedAt: input.generatedAt,
          company: input.company,
          sections: [
            {
              serviceTitle: (input as any).serviceTitle || "Tour Departure",
              travelDate: (input as any).travelDate || "",
              departureTime: (input as any).departureTime || "Not provided",
              totalBookings: (input as any).totalBookings || 0,
              totalGuests: (input as any).totalGuests || 0,
              adults: (input as any).adults || 0,
              children: (input as any).children || 0,
              infants: (input as any).infants || 0,
              guests: (input as any).guests || [],
            },
          ],
        };

  // Page Geometry (A4 Landscape)
  const pageWidth = 841.89;
  const pageHeight = 595.28;
  const marginX = 40;
  const contentWidth = pageWidth - marginX * 2; // 761.89 pt

  // Colors
  const tealPrimary = "0.09 0.40 0.47"; // #176779
  const textDark = "0.10 0.16 0.17"; // #18282A
  const textMuted = "0.45 0.50 0.54"; // #74818A
  const borderLight = "0.90 0.92 0.93"; // #E5EAED
  const rowAltBg = "0.98 0.99 0.99";

  // Table Column Definitions (5 columns matching approved reference design)
  // Total width: 761.89 pt
  const colW = {
    no: 35,
    ref: 115,
    guest: 240,
    pax: 155,
    pickup: 216.89,
  };

  const colX = {
    no: marginX,
    ref: marginX + colW.no,
    guest: marginX + colW.no + colW.ref,
    pax: marginX + colW.no + colW.ref + colW.guest,
    pickup: marginX + colW.no + colW.ref + colW.guest + colW.pax,
  };

  const rowHeight = 36;
  const rowsPerPage = 10;
  const pages: string[][] = [];

  // If there are no sections, create a single empty page
  const sections = data.sections.length > 0 ? data.sections : [
    {
      serviceTitle: "No Scheduled Tours",
      travelDate: data.dateRangeText || "",
      departureTime: "Not provided",
      totalBookings: 0,
      totalGuests: 0,
      adults: 0,
      children: 0,
      infants: 0,
      guests: [],
    },
  ];

  // Helper to render top header and company block (common to every page)
  const renderPageHeader = (cmds: string[]) => {
    // Brand & Title
    cmds.push(textCmd("PHUKETTOURS", marginX, 555, "/F2", 18, tealPrimary));
    cmds.push(textCmd("DAILY TOUR MANIFEST", marginX + 160, 555, "/F2", 15, textDark));
    cmds.push(
      textCmd(
        "Guest List & Pickup Information",
        marginX + 160,
        541,
        "/F1",
        9.5,
        textMuted
      )
    );

    // Company Contact Information (top left subline under brand)
    let contactLine = "";
    if (data.company.phone) contactLine += `Phone: ${data.company.phone}`;
    if (data.company.email) contactLine += (contactLine ? "  |  " : "") + `Email: ${data.company.email}`;
    if (data.company.website) contactLine += (contactLine ? "  |  " : "") + `${data.company.website}`;

    if (contactLine) {
      cmds.push(textCmd(contactLine, marginX, 520, "/F1", 8, textMuted));
    }
  };

  // Helper to render table column headers
  const renderTableHeader = (cmds: string[], thY: number) => {
    cmds.push(rectCmd(marginX, thY - 5, contentWidth, 22, "0.92 0.95 0.96"));
    cmds.push(lineCmd(marginX, thY - 5, marginX + contentWidth, thY - 5, 0.5, borderLight));
    cmds.push(lineCmd(marginX, thY + 17, marginX + contentWidth, thY + 17, 0.5, borderLight));

    cmds.push(textCmd("No.", colX.no + 6, thY + 2, "/F2", 8.5, tealPrimary));
    cmds.push(textCmd("Booking Reference", colX.ref + 6, thY + 2, "/F2", 8.5, tealPrimary));
    cmds.push(textCmd("Guest Name & Contact", colX.guest + 6, thY + 2, "/F2", 8.5, tealPrimary));
    cmds.push(textCmd("Number of Guests", colX.pax + 6, thY + 2, "/F2", 8.5, tealPrimary));
    cmds.push(textCmd("Pickup / Meeting Point", colX.pickup + 6, thY + 2, "/F2", 8.5, tealPrimary));
  };

  // Process each tour section
  for (const section of sections) {
    const totalSectionRows = section.guests.length;
    const sectionPages = Math.max(1, Math.ceil(totalSectionRows / rowsPerPage));

    for (let sPageIdx = 0; sPageIdx < sectionPages; sPageIdx++) {
      const cmds: string[] = [];

      // 1. Header (Brand, Document Title, Company Contact)
      renderPageHeader(cmds);

      // 2. Top Right Summary Box for this Tour
      const summaryBoxW = 290;
      const summaryBoxX = pageWidth - marginX - summaryBoxW;
      cmds.push(rectCmd(summaryBoxX, 516, summaryBoxW, 52, "0.95 0.97 0.98"));
      cmds.push(lineCmd(summaryBoxX, 516, summaryBoxX + summaryBoxW, 516, 0.5, borderLight));
      cmds.push(lineCmd(summaryBoxX, 568, summaryBoxX + summaryBoxW, 568, 0.5, borderLight));
      cmds.push(lineCmd(summaryBoxX, 516, summaryBoxX, 568, 0.5, borderLight));
      cmds.push(lineCmd(summaryBoxX + summaryBoxW, 516, summaryBoxX + summaryBoxW, 568, 0.5, borderLight));

      // Tour Title
      cmds.push(
        textCmd(
          truncateText(section.serviceTitle, 40),
          summaryBoxX + 10,
          554,
          "/F2",
          9.5,
          tealPrimary
        )
      );

      // Travel Date & Departure Time
      const depTimeDisplay = section.departureTime && section.departureTime !== "TBD"
        ? section.departureTime
        : "Not provided";
      const dateDepText = `Date: ${section.travelDate}  |  Departure: ${depTimeDisplay}`;
      cmds.push(textCmd(dateDepText, summaryBoxX + 10, 540, "/F1", 8.5, textDark));

      // Breakdown line
      let paxBreakdown = `${section.adults} ${section.adults === 1 ? "Adult" : "Adults"}`;
      if (section.children > 0) {
        paxBreakdown += `, ${section.children} ${section.children === 1 ? "Child" : "Children"}`;
      }
      if (section.infants > 0) {
        paxBreakdown += `, ${section.infants} ${section.infants === 1 ? "Infant" : "Infants"}`;
      }

      const totalsLine = `Total: ${section.totalBookings} ${section.totalBookings === 1 ? "Booking" : "Bookings"}  |  ${section.totalGuests} Guests (${paxBreakdown})`;
      cmds.push(textCmd(totalsLine, summaryBoxX + 10, 526, "/F1", 8, textMuted));

      // Top Separator
      cmds.push(lineCmd(marginX, 502, marginX + contentWidth, 502, 1, tealPrimary));

      // 3. Table Header
      const thY = 480;
      renderTableHeader(cmds, thY);

      // 4. Table Body Rows
      const startIndex = sPageIdx * rowsPerPage;
      const pageRows = section.guests.slice(startIndex, startIndex + rowsPerPage);
      let rowY = 455;

      if (pageRows.length === 0) {
        cmds.push(rectCmd(marginX, rowY - 15, contentWidth, 40, "0.99 0.99 0.99"));
        cmds.push(
          textCmd(
            "No guest bookings recorded for this tour departure.",
            marginX + 20,
            rowY + 4,
            "/F1",
            9.5,
            textMuted
          )
        );
        rowY -= 40;
      } else {
        pageRows.forEach((row, rIdx) => {
          const bg = rIdx % 2 === 0 ? "1 1 1" : rowAltBg;
          cmds.push(rectCmd(marginX, rowY - 14, contentWidth, rowHeight, bg));
          cmds.push(lineCmd(marginX, rowY - 14, marginX + contentWidth, rowY - 14, 0.5, borderLight));

          // 1. No.
          cmds.push(textCmd(String(row.index), colX.no + 6, rowY + 3, "/F1", 8.5, textMuted));

          // 2. Booking Reference
          cmds.push(textCmd(truncateText(row.bookingRef, 18), colX.ref + 6, rowY + 3, "/F2", 8.5, textDark));

          // 3. Guest Name & Contact
          cmds.push(textCmd(truncateText(row.guestName, 36), colX.guest + 6, rowY + 8, "/F2", 8.5, textDark));
          cmds.push(textCmd(`Phone: ${truncateText(row.phone, 32)}`, colX.guest + 6, rowY - 1, "/F1", 7.5, textMuted));
          cmds.push(textCmd(`Email: ${truncateText(row.email, 34)}`, colX.guest + 6, rowY - 10, "/F1", 7.5, textMuted));

          // 4. Number of Guests
          cmds.push(textCmd(row.guestsText, colX.pax + 6, rowY + 5, "/F2", 8.5, tealPrimary));
          cmds.push(textCmd(row.breakdownText, colX.pax + 6, rowY - 6, "/F1", 7.5, textDark));

          // 5. Pickup / Meeting Point
          cmds.push(textCmd(truncateText(row.pickupLocation, 40), colX.pickup + 6, rowY + 3, "/F1", 8.5, textDark));

          rowY -= rowHeight;
        });
      }

      // Outer table vertical borders
      cmds.push(lineCmd(marginX, thY + 17, marginX, rowY + rowHeight - 14, 0.5, borderLight));
      cmds.push(lineCmd(marginX + contentWidth, thY + 17, marginX + contentWidth, rowY + rowHeight - 14, 0.5, borderLight));

      pages.push(cmds);
    }
  }

  // Add running footer with correct global page count across all sections
  const totalPages = pages.length;
  pages.forEach((cmds, idx) => {
    const pageNum = idx + 1;
    const footerY = 26;
    cmds.push(lineCmd(marginX, footerY + 12, marginX + contentWidth, footerY + 12, 0.5, borderLight));
    cmds.push(
      textCmd(
        `Generated: ${data.generatedAt}`,
        marginX,
        footerY,
        "/F1",
        8,
        textMuted
      )
    );
    cmds.push(
      textCmd(
        `Page ${pageNum} of ${totalPages}`,
        pageWidth - marginX - 60,
        footerY,
        "/F2",
        8,
        tealPrimary
      )
    );
  });

  return buildLandscapePdfDocument(pages);
};
