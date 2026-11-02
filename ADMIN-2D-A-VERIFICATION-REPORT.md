# Admin-2D-A — Cloudinary Media Infrastructure Verification & Security Audit Report

**Date of Audit**: October 30, 2026  
**Target Backend**: `/home/owakeel/Workspace/Owakeel/carlsimpson/qbictravel_backend-main`  
**Target Frontend**: `/home/owakeel/Workspace/Owakeel/carlsimpson/phuket-tours` (Reference Only — Preserved Unmodified)  
**Status**: **PASS (with Security Recommendations)** | Cloudinary Connectivity: **BLOCKED (Missing Live Credentials)**  

---

## 1. Executive Summary

A comprehensive verification and security audit was conducted on the Cloudinary Media Infrastructure implemented during Phase Admin-2D-A. The audit evaluated environment security, signed upload generation, asset verification, database model integrity, deletion safety, API role authorization, and test suite execution.

### Key Audit Highlights
- **Access Control**: All media endpoints are strictly guarded by `authMiddleware` and `requireRole("admin")`. Unauthenticated and non-admin requests (customer, agent, staff) are rejected with 401 and 403 status codes respectively.
- **Secret Hygiene**: The Cloudinary API secret is maintained strictly on the server and is never exposed to the frontend, included in signatures, printed to stdout/stderr, or logged in errors. The Next.js frontend contains zero Cloudinary secrets.
- **Database Non-Destruction**: Prisma migration `20261030101345_add_media_model` is up to date and in sync. All previous Admin-2B PostgreSQL `pg_trgm` indexes on the `Service` table remain intact.
- **Test Baseline**: 31 of 31 test files passed (593 of 593 tests passed), matching the test baseline.
- **Live Cloudinary Status**: Live account connectivity could not be verified because actual production API credentials are not yet populated in the backend `.env` file (safe fallback to HTTP 503 verified).
- **Security Findings**: Two security concerns were identified regarding client-controlled public IDs (overwrite risk) and stateless confirmation author attribution, documented with specific remediation steps below.

---

## 2. Configuration Verification

| Item | Requirement | Verification Method | Status | Notes |
| :--- | :--- | :--- | :---: | :--- |
| `CLOUDINARY_CLOUD_NAME` | Must exist in env when live | Checked via safe boolean existence query | **BLOCKED** | Not yet populated in `.env` |
| `CLOUDINARY_API_KEY` | Must exist in env when live | Checked via safe boolean existence query | **BLOCKED** | Not yet populated in `.env` |
| `CLOUDINARY_API_SECRET` | Must exist in env when live | Checked via safe boolean existence query | **BLOCKED** | Not yet populated in `.env` |
| Missing Credentials Handling | Return safe HTTP 503 response | `mediaService.test.ts` & `mediaRoutes.test.ts` | **PASS** | Returns HTTP 503 with user-friendly message |
| API Secret Leakage Protection | Secret never returned to client | Inspect `mediaService.ts` & integration tests | **PASS** | `apiSecret` excluded from response payloads |
| Error Logging Protection | Secret never printed in logs | Inspect error handlers and serializers | **PASS** | `pino-http` and `errorHandler` do not log secrets |
| Frontend Environment Isolation | No Cloudinary keys in frontend | Recursive grep in `phuket-tours` | **PASS** | Zero Cloudinary references in frontend `.env` |

---

## 3. Signed Upload Security Findings

### Verification Checklist
- [x] **Admin Authentication**: Only authenticated admin sessions can invoke `POST /api/v1/admin/media/signature`.
- [x] **Folder Containment**: Backend strictly enforces `folder: "phukettours/tours"`. Yup validator rejects any attempt by a client to submit custom or arbitrary folders.
- [x] **Official Cloudinary SDK**: `cloudinary.utils.api_sign_request` from `cloudinary` v2 is utilized to compute HMAC signatures.
- [x] **Timestamp Freshness**: Server generates `timestamp: Math.floor(Date.now() / 1000)` ensuring valid 1-hour Cloudinary execution window.
- [x] **File Format & Size Policy**: Policies restrict formats to JPEG, JPG, PNG, WebP, and AVIF, and file size to 10 MB (10,485,760 bytes).
- [x] **Batch Limitation**: `batchSize` is validated to be an integer between 1 and 10. Values above 10 are rejected with HTTP 400.

### Security Concerns Identified
1. **Client-Specified Public ID Overwrite Risk (Severity: HIGH)**:
   - In `src/modules/media/mediaService.ts:48-50`, when `batchSize === 1` and `input.publicId` is provided by the client, the service uses the client-supplied ID instead of generating a server-controlled UUID.
   - Because `overwrite: false` is not explicitly signed in `paramsToSign`, if a malicious or careless admin supplies a `publicId` that matches an existing asset in `phukettours/tours/`, uploading directly to Cloudinary could overwrite the existing image file.

---

## 4. Upload Confirmation Verification

### Verification Checklist
- [x] **Trusted API Verification**: Backend calls `cloudinary.api.resource(publicId, { resource_type: "image" })` directly to fetch authoritative metadata from Cloudinary servers.
- [x] **Zero Client Trust**: Browser-supplied URLs, filenames, dimensions, and MIME types are disregarded; persisted records rely exclusively on Cloudinary's returned object.
- [x] **Folder & Resource Type Validation**: Rejects assets if `resource_type !== "image"` or if the asset path does not begin with `phukettours/tours/`.
- [x] **Server-Side Format & Size Enforcement**: Re-verifies format (rejects SVG, GIF, etc.) and size (<= 10MB) against Cloudinary's authoritative byte count before saving.
- [x] **Idempotency**: Confirmation is fully idempotent. If an asset is confirmed multiple times, the existing `Media` record is returned with HTTP 200 without creating duplicates.
- [x] **Service Relation Validation**: If `serviceId` is supplied, the backend verifies that the corresponding `Service` record exists in PostgreSQL before linking.

### Security Concerns Identified
2. **Stateless Confirmation Authorization Relationship (Severity: MEDIUM)**:
   - In `src/modules/media/mediaService.ts:89-120`, the confirmation endpoint does not verify whether the confirming admin was the one who generated the signature for this asset.
   - If an asset was uploaded out-of-band directly to Cloudinary within `phukettours/tours/`, any authenticated admin can call `POST /confirm` with its `publicId` and claim attribution (`uploadedById: req.user.id`).

---

## 5. Media Database and Migration Findings

### Verification Checklist
- [x] **Schema Validation**: `npx prisma validate` confirms all schemas in `prisma/schema/` are valid.
- [x] **Migration Status**: `npx prisma migrate status` reports 8 migrations applied, database schema is up to date.
- [x] **Constraint Verification**:
  - `Media_assetId_key`: `UNIQUE INDEX ON "Media" ("assetId")`
  - `Media_publicId_key`: `UNIQUE INDEX ON "Media" ("publicId")`
  - `Media_uploadedById_idx`: `INDEX ON "Media" ("uploadedById")`
  - `Media_serviceId_idx`: `INDEX ON "Media" ("serviceId")`
  - `Media_createdAt_idx`: `INDEX ON "Media" ("createdAt" DESC)`
- [x] **Trigram Index Preservation**: Verified via `pg_indexes` that all Admin-2B PostgreSQL `pg_trgm` GIN indexes on `Service` (`Service_name_trgm_idx`, `Service_description_trgm_idx`, `Service_providerName_trgm_idx`) were preserved.

---

## 6. Media Deletion Safety Findings

### Verification Checklist
- [x] **Existence Check**: Missing `mediaId` returns HTTP 404 (`Media not found`).
- [x] **Referenced Asset Protection**: Inspects `Service.metadata` JSONB for active references in `featuredImage` or `images` gallery. Rejects deletion with HTTP 409 Conflict.
- [x] **Deletion Sequencing**: Cloudinary asset destruction occurs *before* database deletion. If Cloudinary deletion fails, the database record is preserved.
- [x] **Cloudinary Response Tolerance**: Handles Cloudinary `{ result: "ok" }` and `{ result: "not found" }` (already gone from Cloudinary) safely.

### Security Concerns Identified
3. **Indirect Reference Check via Metadata vs. Direct Foreign Key (Severity: LOW)**:
   - `findReferencingServices` in `mediaRepository.ts` inspects `Service.metadata::text` for occurrences of `secureUrl` and `publicId`.
   - If a media record is linked via `media.serviceId` to a Service that has not yet serialized its metadata JSON, the media can be deleted, causing `media.serviceId` to cascade to `NULL`.

---

## 7. API Authorization Findings

All 4 endpoints were tested across 5 role states:

| Endpoint | Unauthenticated | Customer | Agent | Staff | Admin |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `POST /api/v1/admin/media/signature` | **401** | **403** | **403** | **403** | **200** |
| `POST /api/v1/admin/media/confirm` | **401** | **403** | **403** | **403** | **201 / 200** |
| `GET /api/v1/admin/media` | **401** | **403** | **403** | **403** | **200** |
| `DELETE /api/v1/admin/media/:mediaId` | **401** | **403** | **403** | **403** | **200** |

All authorization barriers are functional. Non-admin roles cannot access or manipulate media infrastructure.

---

## 8. Automated Test Results

| Test Target | Suite Command | Passed / Total | Status | Notes |
| :--- | :--- | :---: | :---: | :--- |
| Media Unit Tests | `vitest run src/modules/media/tests/unit` | **20 / 20** | **PASS** | Cloudinary SDK mocked |
| Media Integration Tests | `vitest run src/modules/media/tests/integration` | **22 / 22** | **PASS** | Full HTTP & DB cycle |
| Full Backend Test Suite | `npm test` | **593 / 593** (31 files) | **PASS** | Baseline maintained |
| TypeScript Build | `npm run build` (`prisma generate && tsc`) | Exited with code `0` | **PASS** | Zero type errors |
| Prisma Schema | `npx prisma validate` | Valid schemas | **PASS** | Schema valid |
| ESLint | `npm run lint` | N/A | **N/A** | No lint script in backend package.json; tsc handles static checks |

---

## 9. Cloudinary Connectivity Status

- **Status**: **BLOCKED (Missing live credentials in backend `.env`)**
- **Details**: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` are not yet populated in the local `.env` file.
- **Manual Setup Required**:
  1. Register or log in to the Cloudinary Dashboard: `https://cloudinary.com/console`.
  2. Copy the **Cloud name**, **API Key**, and **API Secret**.
  3. Add them to `/home/owakeel/Workspace/Owakeel/carlsimpson/qbictravel_backend-main/.env`:
     ```bash
     CLOUDINARY_CLOUD_NAME="your_cloud_name"
     CLOUDINARY_API_KEY="your_api_key"
     CLOUDINARY_API_SECRET="your_api_secret"
     ```
  4. Once configured, non-destructive live ping can be executed using `cloudinary.api.ping()`.

---

## 10. Issues Found and Severity Matrix

### Issue 1: Client-Specified Public ID Asset Overwrite
- **Severity**: **HIGH**
- **Exact File and Line**: [src/modules/media/mediaService.ts:48-56](file:///home/owakeel/Workspace/Owakeel/carlsimpson/qbictravel_backend-main/src/modules/media/mediaService.ts#L48-L56)
- **What is wrong**: If a client supplies `publicId` when `batchSize === 1`, the signature signs that custom ID. `overwrite: false` is not included in `paramsToSign`.
- **Potential Impact**: If an admin supplies a public ID that already exists in Cloudinary, Cloudinary will overwrite the existing image file, corrupting tour images currently live on the site.
- **Recommended Fix**:
  1. Always enforce server-generated IDs (e.g. `const publicId = tour_${Date.now()}_${randomUUID().slice(0, 8)};`) and ignore client-supplied public IDs, OR
  2. Include `overwrite: false` in `paramsToSign` and check that `publicId` does not already exist in `prisma.media` prior to signing.

### Issue 2: Stateless Confirmation / Missing Authorization Ticket
- **Severity**: **MEDIUM**
- **Exact File and Line**: [src/modules/media/mediaService.ts:89-120](file:///home/owakeel/Workspace/Owakeel/carlsimpson/qbictravel_backend-main/src/modules/media/mediaService.ts#L89-L120)
- **What is wrong**: The confirmation endpoint verifies that the asset exists in `phukettours/tours/` on Cloudinary, but does not verify that the confirming admin was the one issued the signature, nor that the upload originated from a specific authorization request.
- **Potential Impact**: Any admin can confirm assets uploaded by other admins or uploaded directly through Cloudinary web console without signature audit tracking.
- **Recommended Fix**:
  1. Issue a signed upload token (HMAC with server secret) containing `adminId`, `publicId`, and timestamp during `generateUploadSignature`.
  2. Require this token in `confirmUploadedAsset` and verify token integrity before confirming.

### Issue 3: Incomplete Foreign Key Reference Check in `deleteMedia`
- **Severity**: **LOW**
- **Exact File and Line**: [src/modules/media/mediaRepository.ts:161-174](file:///home/owakeel/Workspace/Owakeel/carlsimpson/qbictravel_backend-main/src/modules/media/mediaRepository.ts#L161-L174)
- **What is wrong**: `findReferencingServices` searches `Service.metadata` JSONB for `secureUrl` and `publicId`, but does not check if `media.serviceId` is linked to an existing `Service`.
- **Potential Impact**: If an image is assigned to a tour via `serviceId` but the tour's metadata JSON has not yet been saved, deleting the media will succeed and set `media.serviceId` to NULL.
- **Recommended Fix**:
  In `deleteMedia` or `findReferencingServices`, also check if `media.serviceId` is non-null and references an active `Service`.

---

## 11. Production Readiness Assessment

- **Architecture**: **READY** (Clean separation of signature issuance, direct client-to-Cloudinary upload, server-side trusted API confirmation, and non-destructive persistence).
- **Security & Authorization**: **CONDITIONALLY READY** (Requires addressing Issue 1 before opening to general admin use to prevent accidental image overwrites).
- **Database & Data Integrity**: **READY** (All Prisma models, relations, indexes, and migrations verified).
- **Live Infrastructure**: **PENDING CREDENTIALS** (Requires live Cloudinary credentials from user).

---

## 12. Recommended Next Steps

1. **Awaiting User Review**: In accordance with audit rules, no automated changes have been made.
2. **Apply Security Hardening** (Upon User Approval):
   - Prevent client-supplied `publicId` and sign `overwrite: false`.
   - Add direct `media.serviceId` validation to `deleteMedia`.
3. **Configure Live Cloudinary Credentials**:
   - Supply `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in `.env`.
4. **Proceed to Phase Admin-2D-B (Frontend Media Manager UI)**:
   - Implement upload dialog with drag-and-drop, direct Cloudinary upload progress, and image selection grid.
