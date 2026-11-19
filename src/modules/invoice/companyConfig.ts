/**
 * Company details configuration for financial documents (Invoices & Payment Receipts).
 * Uses environment variables or safe defaults/placeholders.
 * Never invents company registration or tax numbers.
 */

export interface CompanyDetails {
  name: string;
  address: string;
  email: string;
  phone: string;
  registrationNumber: string | null;
  taxId: string | null;
  website: string;
}

export const getCompanyDetails = (): CompanyDetails => {
  return {
    name: process.env.COMPANY_NAME || "PhuketTours Co., Ltd.",
    address:
      process.env.COMPANY_ADDRESS ||
      "123/45 Thaweewong Road, Patong Beach, Kathu, Phuket 83150, Thailand",
    email: process.env.COMPANY_EMAIL || process.env.SMTP_FROM_EMAIL || "billing@phukettours.com",
    phone: process.env.COMPANY_PHONE || "+66 76 000 000",
    registrationNumber: process.env.COMPANY_REGISTRATION_NUMBER || null,
    taxId: process.env.COMPANY_TAX_ID || null,
    website: process.env.COMPANY_WEBSITE || process.env.FRONTEND_URL || "https://phukettours.com",
  };
};
