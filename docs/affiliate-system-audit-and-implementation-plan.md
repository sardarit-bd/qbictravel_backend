# PhuketTours — Affiliate System Audit & Implementation Plan

> **Status:** Architecture Audit & Implementation Blueprint  
> **Repositories:**
> - Backend: `qbictravel_backend-main` (branch `integration/dev-v1`)
> - Frontend: `phuket-tours` (branch `resolve/pr-14-dev-v7-main`)

---

## 1. Existing Architecture Audit (Verified Against Codebase)

### 1.1 Backend (`qbictravel_backend-main`)
- **Runtime & Tooling:** Node.js ESM (`"type": "module"`), Express `^5.2.1`, TypeScript `5.9.3`, Prisma `^7.10.0` with `@prisma/adapter-pg` + `pg`, Yup `^1.7.1`, Vitest `^5.0.4`, Supertest `^7.3.1`.
- **Prisma Schema:** Multi-file schema under `prisma/schema/` (configured in `prisma.config.ts`), generated client at `generated/prisma`, 20 timestamped SQL migrations under `prisma/migrations/`.
- **Auth & Roles:**
  - `prisma/schema/user.prisma`: `User` (`id`, `name`, `email`, `password`, `phone`, `avatarUrl`, `role: UserRole`, `status: UserStatus`, `tokenVersion`, `deletedAt`).
  - `UserRole`: `customer | agent | staff | admin` (no `affiliate` role yet).
  - `src/shared/middleware/authMiddleware.ts`: JWT from `Authorization: Bearer` or `req.cookies.token`, checks `RevokedToken`, `Session`, `tokenVersion`, and `status === "active"`.
  - `src/shared/middleware/requireRole.ts` & `requirePermission.ts`: Role & Staff permission guards.
- **App Wiring (`src/app.ts`):**
  - `httpLogger` → `cors({ origin: ALLOWED_ORIGINS, credentials: true })` → `rateLimit` → raw/JSON webhook routes (`/api/v1/webhooks/stripe`, `/api/v1/webhooks/paypal`) → `express.json({ limit: "10kb" })` → `cookieParser()` → `helmet()` → `csrfProtectionMiddleware` → `/api/v1/*` module routers → `errorHandler`.
- **Booking & Discount Lifecycle (`src/modules/booking/`, `prisma/schema/booking.prisma`):**
  - `Booking`: `customerId`, `agentId?`, `createdById?`, `source` (`AGENT | ADMIN | CUSTOMER | DIRECT`), `serviceId`, `currency`, `basePrice`, `proposedPrice?`, `finalPrice` (`Decimal(10, 2)`), `status`, `paymentStatus` (`UNPAID | PARTIALLY_PAID | PAID`), `fulfillmentStatus`, `assignedStaffId?`, `requiresApproval`.
  - Discounts & approvals: `PriceApproval`, `PricingRule`, `StaffDiscountRequest`, `StaffDiscountAuditEvent`, `BookingHistory`.
- **Existing Agent Commission Architecture (`src/modules/commission/`, `prisma/schema/commission.prisma`):**
  - `CommissionRule` (`PERCENTAGE | FIXED`), `Commission` (`bookingId` unique, `agentId`, `ruleId`, `rateType`, `rateValue`, `baseAmount`, `amount`, `status`), `CommissionAdjustment`, `CommissionRuleAuditLog`.
  - `commissionCalculator.ts` uses integer-cent arithmetic (`Math.round(val * 100)`).
  - Triggered asynchronously via `OutboxMessage` (`topic: CALCULATE_COMMISSION`) when a Stripe/PayPal payment is verified.
  - **Constraint:** Agent commission remains 100% untouched and separate from Affiliate commission.
- **Payment, Webhooks & Outbox (`src/modules/payment/`, `src/modules/outbox/`):**
  - `Payment` (`bookingId`, `customerId`, `amount`, `currency`, `method`, `status`, `stripeSessionId`, `stripePaymentIntentId`, `@@unique([method, reference])`).
  - `StripeWebhookEvent` provides idempotency on `evt_...` IDs + concurrency lock (`lockWebhookEventForProcessing`).
  - `paymentRepository.verifyStripePaymentAtomically` atomically marks `Payment` as `VERIFIED`, `Booking` as `PAID`/`CONFIRMED`, and enqueues `CALCULATE_COMMISSION` + `SEND_BOOKING_VOUCHER_EMAIL` in `OutboxMessage`.
  - `PaymentRefund` exists in schema (`paymentId`, `stripeRefundId`, `amount`, `status`), while `charge.refunded` webhook handling is not yet wired in `paymentService.ts`.
- **Notifications & Email (`src/shared/utils/mailer.ts`, `src/modules/notification/notificationService.ts`):**
  - Nodemailer `sendEmail` + `notificationService` gated by `NotificationSetting`.
- **Tests:** `npm test` (`vitest run`), `npm run test:unit`, `npm run test:integration`.

### 1.2 Frontend (`phuket-tours`)
- **Runtime & Tooling:** Next.js `^16.4.6` (App Router), React `19.3.0`, TypeScript `^5`, Tailwind CSS `^4`, Redux Toolkit `^2.13.0` (RTK Query), React Hook Form + Zod, Lucide icons, Vitest + Testing Library.
- **Auth & Role Routing:**
  - `src/features/auth/types/auth.ts`: `UserRole = "customer" | "agent" | "staff" | "admin"`.
  - `src/features/auth/components/dashboard-guard.tsx`: Strict portal separation (`/dashboard/admin*`, `/dashboard/staff*`, `/dashboard/agent*`, `/dashboard` for customer).
- **Dashboard Shell & Navigation:**
  - `src/features/dashboard/components/dashboard-shell.tsx` & `dashboard-sidebar.tsx` (270px sidebar, collapsible submenus, permission filtering).
  - `src/features/dashboard/types/dashboard-nav.ts`: `adminNavConfig`, `staffNavConfig`, `agentNavConfig`, `userNavConfig`.
- **RTK Query (`src/lib/api/base-api.ts`):**
  - `baseApi` with `credentials: "include"`, Bearer token injection, 401 refresh mutex (`SimpleMutex` + Web Locks), and typed `tagTypes`.
- **Public Shell & Checkout:**
  - `src/components/layout/public-shell.tsx` wraps all public pages (`/`, `/tours`, `/tours/[id]`, `/checkout`).
  - `src/app/checkout/page.tsx` calls `useCreateCustomerBookingMutation()` for customer bookings.

---

## 2. Proposed Affiliate System Architecture (New Functionality)

### 2.1 Database Entities (`prisma/schema/affiliate.prisma`)
Adapted to existing Prisma conventions (`@id @default(uuid())`, `Decimal @db.Decimal(10, 2)`, `@map` snake_case table/column names):

1. **`UserRole` enum extension:** Add `affiliate` to `UserRole` (non-destructive enum addition). Any authenticated user can also apply to become an affiliate; on Admin approval, their `Affiliate` profile becomes `APPROVED` (and if `customer`, role can be upgraded to `affiliate`, or `affiliate` role is granted while keeping existing auth/JWT intact).
2. **`Affiliate` (`affiliates`):**
   - `id`, `userId` (`@unique`, FK → `User`), `code` (`@unique`, e.g. `AFF1025`), `status` (`PENDING | APPROVED | REJECTED | SUSPENDED`), `commissionRateOverride: Decimal(5, 2)?` (nullable; overrides global rate when set), `payoutMethod: String?`, `payoutDetails: Json?`, `websiteUrl: String?`, `promotionChannels: String?`, `rejectionReason: String?`, `approvedAt`, `approvedById?`, `suspendedAt`, `createdAt`, `updatedAt`.
3. **`AffiliateLink` (`affiliate_links`):**
   - `id`, `affiliateId` (FK → `Affiliate`), `slug` (`@unique` optional label), `tourId` (nullable FK → `Service`), `targetPath` (e.g. `/tours/phi-phi-island` or `/`), `isActive`, `clickCount`, `createdAt`.
4. **`AffiliateClick` (`affiliate_clicks`):**
   - `id`, `affiliateId` (FK → `Affiliate`), `affiliateLinkId?` (FK → `AffiliateLink`), `referralCode`, `visitorToken` (hashed/opaque token stored in HttpOnly cookie), `landingUrl`, `referrer`, `ipHash`, `userAgent`, `expiresAt`, `createdAt`.
5. **`AffiliateBookingAttribution` (`affiliate_booking_attributions`):**
   - Dedicated 1:1 relation to `Booking` (`bookingId @unique`, FK → `Booking`) so `Booking` ownership, `agentId`, `createdById`, and `source` remain untouched.
   - Fields: `id`, `bookingId @unique`, `affiliateId`, `affiliateClickId?`, `referralCode`, `attributedAt`, `windowDays`, `createdAt`. Immutable once created.
6. **`AffiliateCommission` (`affiliate_commissions`):**
   - `id`, `affiliateId`, `bookingId`, `paymentId?`, `entryType` (`EARNED | REVERSAL | ADJUSTMENT`), `eligibleAmount: Decimal(10, 2)`, `commissionRate: Decimal(5, 2)`, `amount: Decimal(10, 2)` (negative for reversals), `currency`, `status` (`PENDING | AVAILABLE | PAID | REVERSED`), `idempotencyKey @unique`, `notes?`, `createdById?`, `createdAt`, `updatedAt`.
7. **`AffiliatePayout` (`affiliate_payouts`):**
   - `id`, `affiliateId`, `amount: Decimal(10, 2)`, `currency`, `status` (`PENDING | APPROVED | REJECTED | PAID`), `payoutMethod`, `payoutDetailsSnapshot: Json?`, `rejectionReason?`, `transactionReference?`, `paidAt?`, `processedById?`, `requestedAt`, `updatedAt`.
8. **`AffiliateSettings` (`affiliate_settings`):**
   - Singleton config table: `id`, `globalCommissionRate: Decimal(5, 2)` (default `10.00`), `attributionWindowDays: Int` (default `30`), `minimumPayoutAmount: Decimal(10, 2)` (default `50.00`), `eligibleAmountPolicy` (`NET_AFTER_DISCOUNTS | GROSS`), `isProgramActive: Boolean` (default `true`), `updatedById?`, `updatedAt`.
9. **`AffiliateAuditEvent` (`affiliate_audit_events`):**
   - `id`, `affiliateId?`, `entityType` (`AFFILIATE | COMMISSION | PAYOUT | SETTINGS`), `entityId`, `action`, `actorId?`, `actorRole?`, `metadata: Json?`, `createdAt`.

### 2.2 Attribution & Commission Lifecycle
1. **Click Tracking (`POST /api/v1/affiliates/track-click`):**
   - Frontend `AffiliateRefTracker` mounted in `PublicShell` detects `?ref=<code>` on any public page and calls `POST /api/v1/affiliates/track-click` with `{ code, landingUrl, referrer }`.
   - Backend validates `Affiliate` exists and `status === "APPROVED"`.
   - Records `AffiliateClick` with `expiresAt = now + settings.attributionWindowDays`.
   - Sets HttpOnly, `SameSite=Lax`, `Secure` (in production) cookie `pt_aff_ref` containing signed/opaque `{ clickId, code, affiliateId, exp }` (HMAC-signed with `JWT_SECRET` so it cannot be forged client-side).
   - Last-click: any newer valid click overwrites `pt_aff_ref`.
2. **Booking Attribution (at `createBooking`):**
   - Only eligible for customer self-bookings (`!isAgent`, `source === "CUSTOMER"`). Never attributes Admin/Staff/Agent operational bookings.
   - Reads and verifies `pt_aff_ref` cookie (falls back to validated `referralCode` only if cookie unavailable and verified server-side, never trusting affiliateId/rate).
   - Rejects if expired, affiliate not `APPROVED`, or **self-referral** (`affiliate.userId === customerId`).
   - Persists immutable `AffiliateBookingAttribution` row inside the booking creation transaction.
3. **Commission Generation (Verified Payment Only):**
   - Triggered inside `verifyStripePaymentAtomically` / PayPal verified capture (via dedicated `affiliateCommissionService.recordCommissionForVerifiedPayment(tx, paymentId)` or outbox `CALCULATE_AFFILIATE_COMMISSION` topic).
   - Idempotency key: `payment:${payment.id}:earned` — repeated webhooks cannot create duplicate commissions.
   - Capped so total earned commission across partial payments never exceeds `booking.finalPrice × appliedRate / 100`.
   - Uses integer-cent arithmetic (`Math.round`) — no floating-point drift.
   - Snapshots `commissionRate` (individual `commissionRateOverride ?? settings.globalCommissionRate`), `eligibleAmount`, `currency`, and `amount`.
4. **Refund / Cancellation Reversal:**
   - Dedicated `affiliateCommissionService.recordReversalForRefund(tx, { bookingId, paymentId, refundAmount, refundId, reason })` creates a negative `REVERSAL` ledger entry with idempotency key `refund:${refundId}` (never deletes historical rows).
   - Wired into `charge.refunded` Stripe webhook and Admin booking cancellation/refund flows.
5. **Payout Workflow (Manual Only, Concurrency-Safe):**
   - `availableBalance = SUM(AVAILABLE/EARNED commissions) + SUM(REVERSAL/ADJUSTMENT) - SUM(PENDING/APPROVED/PAID payouts)`.
   - Creating a payout request runs inside `prisma.$transaction` with row-level lock (`SELECT ... FOR UPDATE` on `affiliates` row) to prevent concurrent double-reservation.
   - Rejecting a payout releases the reserved balance automatically (since `REJECTED` payouts are excluded from reserved sum).
   - Marking as `PAID` checks `status !== "PAID"` inside a transaction (prevents double payment) and records `paymentMethod`, `transactionReference`, `paidAt`, and `processedById`.

### 2.3 Proposed Backend API Endpoints (`/api/v1/...`)
- **Public Tracking:**
  - `POST /api/v1/affiliates/track-click` — validate code, record click, set HttpOnly `pt_aff_ref` cookie.
  - `GET /api/v1/affiliates/validate/:code` — validate code status (returns minimal public info only).
- **Affiliate Portal (authenticated):**
  - `POST /api/v1/affiliate/apply` — submit affiliate application.
  - `GET /api/v1/affiliate/me` — own profile & application status.
  - `PATCH /api/v1/affiliate/profile` — update permitted profile & payout details.
  - `GET /api/v1/affiliate/dashboard` — overview metrics (clicks, bookings, conversion rate, earned, pending, available, paid).
  - `GET /api/v1/affiliate/links` & `POST /api/v1/affiliate/links` — list/create general & tour-specific links.
  - `GET /api/v1/affiliate/clicks` — click analytics (paginated).
  - `GET /api/v1/affiliate/bookings` — referred bookings (privacy-safe).
  - `GET /api/v1/affiliate/commissions` — commission ledger history.
  - `GET /api/v1/affiliate/payouts` & `POST /api/v1/affiliate/payouts` — payout history & request submission.
- **Admin Affiliate Management (`requireRole("admin")`):**
  - `GET /api/v1/admin/affiliates/overview` — program KPIs & summary.
  - `GET /api/v1/admin/affiliates` — list/filter/search affiliates (including applications).
  - `GET /api/v1/admin/affiliates/:id` — full affiliate details + performance.
  - `PATCH /api/v1/admin/affiliates/:id/approve` — approve application.
  - `PATCH /api/v1/admin/affiliates/:id/reject` — reject with required reason.
  - `PATCH /api/v1/admin/affiliates/:id/suspend` & `PATCH /api/v1/admin/affiliates/:id/reactivate`.
  - `PATCH /api/v1/admin/affiliates/:id/commission-rate` — set/clear individual override.
  - `GET /api/v1/admin/affiliates/settings` & `PATCH /api/v1/admin/affiliates/settings` — global settings.
  - `GET /api/v1/admin/affiliates/bookings` — attributed bookings.
  - `GET /api/v1/admin/affiliates/commissions` — commission ledger.
  - `GET /api/v1/admin/affiliates/payouts` — list payout requests.
  - `PATCH /api/v1/admin/affiliates/payouts/:id/approve` — approve payout.
  - `PATCH /api/v1/admin/affiliates/payouts/:id/reject` — reject with required reason.
  - `PATCH /api/v1/admin/affiliates/payouts/:id/mark-paid` — mark manually paid with method + reference + date.
  - `GET /api/v1/admin/affiliates/audit-events` — audit history & reports.

### 2.4 Proposed Frontend Pages & Navigation (`phuket-tours`)
- **Public Referral Capture:** `src/features/affiliate/components/affiliate-ref-tracker.tsx` mounted in `PublicShell`.
- **Affiliate Portal (`/dashboard/affiliate/*`):**
  - `affiliateNavConfig` in `dashboard-nav.ts`, `UserRole` extended with `"affiliate"`, `DashboardGuard` updated for `/dashboard/affiliate*`.
  - Pages: Overview (`/dashboard/affiliate`), My Links (`/dashboard/affiliate/links`), Click Analytics (`/dashboard/affiliate/clicks`), Referred Bookings (`/dashboard/affiliate/bookings`), Commission History (`/dashboard/affiliate/commissions`), Payout Requests (`/dashboard/affiliate/payouts`), Payment Details (`/dashboard/affiliate/payment-details`), Profile & Settings (`/dashboard/affiliate/profile`), plus Application/Status view for pending/new applicants.
- **Admin Affiliate Management (`/dashboard/admin/affiliates/*`):**
  - Added to `adminNavConfig` (`adminOnly: true`) with submenu: Overview, Applications, All Affiliates, Commission Settings, Affiliate Bookings, Commission Ledger, Payout Requests, Reports & Audit.

---

## 3. Migration, Security & Testing Strategy

- **Migration Strategy:** Additive-only Prisma migration (`20261119000000_add_affiliate_system/migration.sql`) adding `affiliate` to `UserRole` and creating the new `affiliate_*` tables. Zero destructive changes; zero modifications to existing tables/columns.
- **Security & Financial Integrity:**
  - HMAC-signed HttpOnly attribution cookie; server-side validation on click and booking creation.
  - Self-referral blocked; suspended/rejected/pending affiliates cannot earn commission.
  - Integer-cent math; `prisma.$transaction` + `FOR UPDATE` row locks on payout reservation; unique `idempotencyKey` on commission/reversal ledger entries.
  - Strict role isolation (`admin` vs `affiliate` vs `agent`/`staff`/`customer`); affiliates can only access their own records.
- **Testing Strategy:**
  - Backend unit tests: cent-based commission calculator, attribution cookie signing/verification, payout balance/reservation logic.
  - Backend integration tests: Supertest routes for public tracking, affiliate portal, admin management, webhook idempotency, refund reversals, concurrent payout protection.
  - Frontend unit/component tests (Vitest + RTL): Affiliate overview/links/payouts/status, Admin affiliate review/settings/payout processing.

---

## 4. Ordered Implementation Phases
1. **Phase B:** Prisma schema (`prisma/schema/affiliate.prisma`, `UserRole` enum update) + reviewed additive SQL migration + `prisma generate`.
2. **Phase C:** Backend `src/modules/affiliate/` (calculator, cookie/attribution helper, repository, service, controller, validation, routes) + wire into `src/app.ts` + notifications.
3. **Phase D:** Integrate attribution into `bookingService.ts` (customer bookings only) and commission/reversal into `paymentService.ts` / `paymentRepository.ts` / `outboxService.ts`.
4. **Phase E:** Frontend Affiliate RTK Query API (`affiliate-api.ts`), `AffiliateRefTracker`, `UserRole`/`DashboardGuard`/`DashboardNav` updates, and Affiliate Dashboard pages.
5. **Phase F:** Frontend Admin Affiliate Management pages and `adminNavConfig` integration.
6. **Phase G & H:** Notification wiring, backend & frontend tests, typecheck, lint, and production builds for both repos.
