# Omise Payment Gateway Setup & Configuration Guide

**Project:** QbicTravel / PhuketTours  
**Active Payment Provider:** Omise (Opn Payments)  
**Supported Payment Methods:** Credit / Debit Card (THB currency)

---

## 1. Overview & Architecture Summary

Omise has been integrated as the **active, primary payment provider** for all customer-facing card checkout flows and public payment links.
- **Frontend Tokenization**: Raw card credentials never touch QbicTravel servers. `Omise.js` directly tokenizes card data in the browser using the public key (`NEXT_PUBLIC_OMISE_PUBLIC_KEY`).
- **Backend Settlement**: The backend receives single-use tokens (`tokn_...`) and communicates with Omise's API (`https://api.omise.co`) via Basic Authentication using `OMISE_SECRET_KEY`.
- **3-D Secure (3DS)**: Charges requiring cardholder challenge are returned with `requiresAction: true` and an `authorizeUri`. Upon cardholder authorization, the return URL authoritatively verifies payment state with Omise.
- **Webhook Ingestion**: Asynchronous notifications (such as `charge.complete` or `charge.refunded`) are verified using HMAC-SHA256 with timestamp replay protection.

---

## 2. Backend Server Configuration

### 2.1 Required Environment Variables

Add the following environment variables to your backend `.env` file (refer to `.env.example`):

```bash
# --- Omise Payment Gateway Configuration ---
OMISE_PUBLIC_KEY="pkey_test_..."
OMISE_SECRET_KEY="skey_test_..."
OMISE_WEBHOOK_SECRET="your_base64_webhook_secret_from_dashboard"
OMISE_API_BASE_URL="https://api.omise.co"
```

### 2.2 Where to Obtain Credentials

1. Sign in to your **[Omise Dashboard](https://dashboard.omise.co/)**.
2. Toggle between **Test** and **Live** modes using the environment switch in the dashboard sidebar.
3. Navigate to **Keys** in the left menu:
   - **Public Key** (`pkey_test_...` or `pkey_...`): Used for client-side tokenization.
   - **Secret Key** (`skey_test_...` or `skey_...`): Used strictly by the backend for charge creation and refunds.
4. Navigate to **Webhooks** in the left menu:
   - Copy the **Webhook Secret Key** (encoded in Base64).

> **SECURITY NOTE:** Never expose `OMISE_SECRET_KEY` or `OMISE_WEBHOOK_SECRET` in client bundles, public code, or log files.

### 2.3 Applying Changes and Restarting Backend

After updating `.env` on your production/staging host:
```bash
# If running with PM2:
pm2 restart qbictravel-backend

# If running with Docker Compose:
docker compose down && docker compose up -d --build
```

---

## 3. Frontend Client Configuration

### 3.1 Required Environment Variables

Add the public key to `phuket-tours/.env` or `.env.local` (refer to `.env.example`):

```bash
# Public key for browser Omise.js card tokenization
NEXT_PUBLIC_OMISE_PUBLIC_KEY="pkey_test_..."
```

### 3.2 Production Rebuild Requirement

Because `NEXT_PUBLIC_*` variables are statically embedded into client bundles at build time by Next.js, **you must rebuild the frontend application** whenever you change `NEXT_PUBLIC_OMISE_PUBLIC_KEY`:

```bash
npm run build
pm2 restart phuket-tours-frontend
```

---

## 4. Omise Dashboard Webhook Setup

### 4.1 Endpoint URL Pattern

In your Omise Dashboard, register the webhook endpoint with the exact URL:

- **Staging / Test:**  
  `https://your-api-domain.com/api/v1/webhooks/omise`  
  *(Local testing via ngrok/tunnel: `https://<subdomain>.ngrok-free.app/api/v1/webhooks/omise`)*

- **Production / Live:**  
  `https://api.qbictravel.com/api/v1/webhooks/omise` (or your configured production domain)

### 4.2 Webhook Signature Specification & Verification

QbicTravel implements Omise's official signature standard:
- **Signature Header:** `Omise-Signature`
- **Timestamp Header:** `Omise-Signature-Timestamp`
- **Signed Payload:** `${timestamp}.${rawBody}`
- **Secret Handling:** Webhook secret is Base64-decoded into raw bytes before HMAC-SHA256 calculation.
- **Replay Protection:** Timestamps older than 300 seconds are rejected.
- **Key Rotation Support:** Multiple comma-separated signatures and secrets are supported during rotation grace periods.

### 4.3 Monitored Events

- `charge.complete`: Confirms card payment completion and automatically transitions bookings to `CONFIRMED` and `PAID`.
- `charge.refunded` / `refund.create`: Reconciles refund events and records commission reversals.

---

## 5. End-to-End Test Mode Checklist

When testing in Omise Test Mode:

1. **Test Cards**: Use official Omise test cards from [Omise Test Cards Documentation](https://docs.omise.co/test-cards).
   - **Successful non-3DS**: Test card passing without challenge.
   - **3-D Secure Challenge**: Test card triggering bank OTP / 3DS challenge simulator.
   - **Failed / Insufficient Funds**: Test card simulating declined transactions.
2. **Verification**:
   - Check that customer checkout immediately verifies frictionless cards.
   - Check that 3DS transactions redirect to the Omise simulator, then return to `/checkout/omise-return` and display confirmed payment.
   - Check that public payment links (`/pay/[token]`) process payments and handle 3DS return states seamlessly.
   - Inspect the **Omise Dashboard -> Events / Logs** to view incoming webhook requests and `200 OK` delivery responses.
