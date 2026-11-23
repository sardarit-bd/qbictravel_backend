import { describe, it, expect } from "vitest";
import {
  generateTourSchedulePdfBuffer,
  generateDailyManifestPdfBuffer,
  SchedulePdfData,
  ManifestPdfData,
} from "../../operationsPdfService.js";

describe("Operations PDF Generation Service", () => {
  const mockCompany = {
    name: "PhuketTours",
    email: "support@phukettours.com",
    phone: "+66 76 123 4567",
    website: "https://phukettours.com",
  };

  const mockScheduleData: SchedulePdfData = {
    title: "TOUR SCHEDULE",
    dateRangeText: "2026-11-20 to 2026-11-30",
    generatedAt: "2026-11-23 10:30 AM",
    totalTours: 2,
    totalBookings: 3,
    totalPassengers: 7,
    company: mockCompany,
    rows: [
      {
        travelDate: "2026-11-25",
        serviceTitle: "Phi Phi Islands Sunrise & Maya Bay Speedboat Tour",
        departureTime: "07:30",
        totalBookings: 2,
        totalPassengers: 5,
        adults: 3,
        children: 2,
        infants: 0,
        pickupSummaryText: "Patong Merlin Hotel Lobby, Kata Beach Resort",
        operationalStatus: "CONFIRMED",
      },
      {
        travelDate: "2026-11-26",
        serviceTitle: "James Bond Island & Phang Nga Bay Sea Canoe",
        departureTime: "08:30",
        totalBookings: 1,
        totalPassengers: 2,
        adults: 2,
        children: 0,
        infants: 0,
        pickupSummaryText: "Hilton Phuket Arcadia",
        operationalStatus: "NOT_STARTED",
      },
    ],
  };

  const mockManifestData: ManifestPdfData = {
    title: "DAILY TOUR MANIFEST",
    serviceTitle: "Phi Phi Islands Sunrise & Maya Bay Speedboat Tour",
    travelDate: "2026-11-25",
    departureTime: "07:30",
    generatedAt: "2026-11-23 10:30 AM",
    totalBookings: 2,
    totalGuests: 5,
    adults: 3,
    children: 2,
    infants: 0,
    company: mockCompany,
    guests: [
      {
        index: 1,
        bookingRef: "PKT-20261125-001",
        guestName: "Alice Wonderland",
        phone: "+66 81 234 5678",
        email: "alice@example.com",
        guestsText: "3 Guests",
        breakdownText: "2 Adults, 1 Child",
        pickupLocation: "Patong Merlin Hotel Lobby",
      },
      {
        index: 2,
        bookingRef: "PKT-20261125-002",
        guestName: "Bob Builder",
        phone: "+66 82 345 6789",
        email: "bob@example.com",
        guestsText: "2 Guests",
        breakdownText: "1 Adult, 1 Child",
        pickupLocation: "Kata Beach Resort",
      },
    ],
  };

  describe("generateTourSchedulePdfBuffer", () => {
    it("generates a valid PDF-1.4 buffer with correct header and trailer", () => {
      const buffer = generateTourSchedulePdfBuffer(mockScheduleData);

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(1000);

      const pdfText = buffer.toString("binary");
      expect(pdfText.startsWith("%PDF-1.4")).toBe(true);
      expect(pdfText.includes("%%EOF")).toBe(true);
    });

    it("includes company contact info and KPIs in schedule PDF", () => {
      const buffer = generateTourSchedulePdfBuffer(mockScheduleData);

      const pdfText = buffer.toString("binary");
      expect(pdfText).toContain("TOUR SCHEDULE");
      expect(pdfText).toContain("PHUKETTOURS");
      expect(pdfText).toContain("support@phukettours.com");
      expect(pdfText).toContain("+66 76 123 4567");
      expect(pdfText).toContain("Phi Phi Islands Sunrise");
    });

    it("handles multi-page schedule data gracefully with repeated headers and Page X of Y", () => {
      const manyRows = Array.from({ length: 20 }, (_, i) => ({
        travelDate: "2026-11-25",
        serviceTitle: `Excursion Tour Route #${i + 1}`,
        departureTime: "08:00",
        totalBookings: 2,
        totalPassengers: 4,
        adults: 2,
        children: 2,
        infants: 0,
        pickupSummaryText: `Location ${i}`,
        operationalStatus: "NOT_STARTED",
      }));

      const multiPageData: SchedulePdfData = {
        ...mockScheduleData,
        totalTours: manyRows.length,
        rows: manyRows,
      };

      const buffer = generateTourSchedulePdfBuffer(multiPageData);

      const pdfText = buffer.toString("binary");
      expect(pdfText).toMatch(/Page 1 of [2-9]/);
      expect(pdfText).toMatch(/Page 2 of [2-9]/);
    });

    it("strictly excludes financial data (no prices, amounts, credit card, currency symbols)", () => {
      const buffer = generateTourSchedulePdfBuffer(mockScheduleData);

      const pdfText = buffer.toString("binary");
      expect(pdfText).not.toContain("THB");
      expect(pdfText).not.toContain("USD");
      expect(pdfText).not.toContain("Total Paid");
      expect(pdfText).not.toContain("Refund");
      expect(pdfText).not.toContain("Invoice");
    });
  });

  describe("generateDailyManifestPdfBuffer", () => {
    it("generates a valid Daily Manifest PDF buffer with guest manifest columns", () => {
      const buffer = generateDailyManifestPdfBuffer(mockManifestData);

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(1000);

      const pdfText = buffer.toString("binary");
      expect(pdfText.startsWith("%PDF-1.4")).toBe(true);
      expect(pdfText.includes("%%EOF")).toBe(true);
      expect(pdfText).toContain("DAILY TOUR MANIFEST");
      expect(pdfText).toContain("Phi Phi Islands Sunrise");
      expect(pdfText).toContain("PKT-20261125-001");
      expect(pdfText).toContain("Alice Wonderland");
      expect(pdfText).toContain("Patong Merlin");
      expect(pdfText).toContain("3 Guests");
      expect(pdfText).toContain("2 Adults, 1 Child");
      expect(pdfText).toContain("Bob Builder");
      expect(pdfText).toContain("Phone: +66 81 234 5678");
      expect(pdfText).toContain("Email: alice@example.com");
    });

    it("handles multi-page manifest guest list", () => {
      const manyGuests = Array.from({ length: 25 }, (_, i) => ({
        index: i + 1,
        bookingRef: `PKT-REF-${i + 100}`,
        guestName: `Guest Passenger Number ${i + 1}`,
        phone: `+66 81 000 ${String(i).padStart(4, "0")}`,
        email: `guest${i}@example.com`,
        guestsText: "2 Guests",
        breakdownText: "2 Adults",
        pickupLocation: `Pickup Point Hotel #${i + 1}`,
      }));

      const multiPageManifest: ManifestPdfData = {
        ...mockManifestData,
        totalBookings: manyGuests.length,
        totalGuests: manyGuests.length * 2,
        adults: manyGuests.length * 2,
        guests: manyGuests,
      };

      const buffer = generateDailyManifestPdfBuffer(multiPageManifest);

      const pdfText = buffer.toString("binary");
      expect(pdfText).toMatch(/Page 1 of [2-9]/);
      expect(pdfText).toMatch(/Page 2 of [2-9]/);
    });

    it("strictly excludes any financial data in daily manifest", () => {
      const buffer = generateDailyManifestPdfBuffer(mockManifestData);

      const pdfText = buffer.toString("binary");
      expect(pdfText).not.toContain("THB");
      expect(pdfText).not.toContain("Total Amount");
      expect(pdfText).not.toContain("Paid Amount");
      expect(pdfText).not.toContain("Discount");
    });

    it("generates a unified multi-tour manifest with distinct tour sections", () => {
      const unifiedData = {
        title: "DAILY TOUR MANIFEST",
        subtitle: "Guest List & Pickup Information",
        dateRangeText: "2026-11-20 to 2026-11-25",
        generatedAt: "2026-11-23 11:30 AM",
        company: mockCompany,
        sections: [
          {
            serviceTitle: "Phi Phi Islands Sunrise Tour",
            travelDate: "2026-11-20",
            departureTime: "07:30 AM",
            totalBookings: 1,
            totalGuests: 2,
            adults: 2,
            children: 0,
            infants: 0,
            guests: [
              {
                index: 1,
                bookingRef: "PKT-001",
                guestName: "Alice Wonderland",
                phone: "+66 81 234 5678",
                email: "alice@example.com",
                guestsText: "2 Guests",
                breakdownText: "2 Adults",
                pickupLocation: "Patong Merlin Hotel",
              },
            ],
          },
          {
            serviceTitle: "Similan Islands Day Trip",
            travelDate: "2026-11-25",
            departureTime: "Not provided",
            totalBookings: 1,
            totalGuests: 3,
            adults: 2,
            children: 1,
            infants: 0,
            guests: [
              {
                index: 1,
                bookingRef: "PKT-002",
                guestName: "Bob Builder",
                phone: "Not provided",
                email: "bob@example.com",
                guestsText: "3 Guests",
                breakdownText: "2 Adults, 1 Child",
                pickupLocation: "Kata Beach Resort",
              },
            ],
          },
        ],
      };

      const buffer = generateDailyManifestPdfBuffer(unifiedData);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      const pdfText = buffer.toString("binary");
      expect(pdfText).toContain("Phi Phi Islands Sunrise Tour");
      expect(pdfText).toContain("Similan Islands Day Trip");
      expect(pdfText).toContain("Departure: Not provided");
      expect(pdfText).toContain("PKT-001");
      expect(pdfText).toContain("PKT-002");
      expect(pdfText).toContain("Page 1 of 2");
      expect(pdfText).toContain("Page 2 of 2");
    });
  });
});
