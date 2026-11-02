export interface PermissionDefinition {
  id: string;
  name: string;
  module: string;
  description: string;
}

export const PERMISSION_MODULES = [
  "dashboard",
  "tours",
  "bookings",
  "users",
  "payments",
  "media",
  "reports",
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export const SUPPORTED_PERMISSIONS: readonly PermissionDefinition[] = [
  // Dashboard
  {
    id: "dashboard.view",
    name: "View Dashboard Overview",
    module: "dashboard",
    description: "Access executive KPI metrics, analytics, and operational summary cards",
  },

  // Tours (Services)
  {
    id: "tours.view",
    name: "View Tours",
    module: "tours",
    description: "View tour listings, schedules, details, and pricing configurations",
  },
  {
    id: "tours.create",
    name: "Create Tours",
    module: "tours",
    description: "Create and publish new tour listings and service profiles",
  },
  {
    id: "tours.edit",
    name: "Edit Tours",
    module: "tours",
    description: "Update tour descriptions, publish status, standard pricing, and calendar availability",
  },

  // Bookings (Operations)
  {
    id: "bookings.view",
    name: "View Bookings Queue",
    module: "bookings",
    description: "View the full operational reservations queue and traveler booking details",
  },
  {
    id: "bookings.assign",
    name: "Assign Staff",
    module: "bookings",
    description: "Assign or reassign operational staff and tour guides to reservations",
  },
  {
    id: "bookings.update_status",
    name: "Update Fulfillment Status",
    module: "bookings",
    description: "Update tour fulfillment progress from Not Started to In Progress and Fulfilled",
  },
  {
    id: "bookings.approve_price",
    name: "Approve Negotiated Prices",
    module: "bookings",
    description: "Review and approve or reject custom pricing proposals requested by agents",
  },

  // Users Management
  {
    id: "users.view",
    name: "View Users Directory",
    module: "users",
    description: "Browse registered accounts, agency partners, and staff team members",
  },
  {
    id: "users.edit",
    name: "Edit User Accounts",
    module: "users",
    description: "Update contact details, names, and phone numbers for user profiles",
  },
  {
    id: "users.invite_staff",
    name: "Invite Staff Members",
    module: "users",
    description: "Send 72-hour onboarding invitations to new operational staff members",
  },
  {
    id: "users.invite_agent",
    name: "Invite Travel Agents",
    module: "users",
    description: "Send 72-hour onboarding invitations to partner travel agencies",
  },
  {
    id: "users.deactivate",
    name: "Deactivate/Activate Accounts",
    module: "users",
    description: "Suspend or reactivate user accounts with immediate session revocation",
  },
  {
    id: "users.delete",
    name: "Delete Users",
    module: "users",
    description: "Soft-delete and archive user accounts while preserving booking and audit records",
  },

  // Payments
  {
    id: "payments.view",
    name: "View Payments",
    module: "payments",
    description: "Inspect customer payment records, gateway transactions, and uploaded receipts",
  },
  {
    id: "payments.verify",
    name: "Verify Customer Payments",
    module: "payments",
    description: "Review and approve or reject customer manual bank transfer and cash receipts",
  },
  {
    id: "payments.record",
    name: "Record Offline Payments",
    module: "payments",
    description: "Record offline or manual cash receipts collected outside automated gateways",
  },

  // Media Library
  {
    id: "media.view",
    name: "View Media Assets",
    module: "media",
    description: "Browse photo gallery, uploaded tour images, and Cloudinary media assets",
  },
  {
    id: "media.upload",
    name: "Upload Media Assets",
    module: "media",
    description: "Upload and optimize tour photographs and gallery assets",
  },
  {
    id: "media.delete",
    name: "Delete Media Assets",
    module: "media",
    description: "Permanently delete unreferenced media assets from Cloudinary and database",
  },

  // Financial & Operational Reports
  {
    id: "reports.view",
    name: "View Reports",
    module: "reports",
    description: "Access booking volume, revenue analytics, payment reconciliation, and commission reports",
  },
] as const;

export type PermissionId = (typeof SUPPORTED_PERMISSIONS)[number]["id"];

export const ALL_PERMISSION_IDS: readonly PermissionId[] = SUPPORTED_PERMISSIONS.map(
  (p) => p.id as PermissionId
);

export const SUPPORTED_PERMISSION_IDS_SET = new Set<string>(ALL_PERMISSION_IDS);
