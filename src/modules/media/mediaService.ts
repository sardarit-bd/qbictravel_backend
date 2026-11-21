import { createHash, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import env from "../../config/env.js";
import {
  ALLOWED_FORMATS,
  CLOUDINARY_FOLDER,
  MAX_BATCH_FILES,
  MAX_FILE_SIZE_BYTES,
  getCloudinaryClient,
  getCloudinaryConfig,
} from "../../config/cloudinary.js";
import AppError from "../../shared/utils/AppError.js";
import {
  consumeAuthAndCreateMedia,
  createMediaUploadAuthRecord,
  deleteMediaRecord,
  findMediaByAssetId,
  findMediaById,
  findMediaByPublicId,
  findMediaUploadAuthByPublicId,
  findReferencingServices,
  findServiceById,
  listMedia as listMediaRepo,
  updateMediaRecord,
} from "./mediaRepository.js";
import type {
  ConfirmMediaInput,
  CreateSignatureInput,
  GetMediaQuery,
  PaginatedMediaResponse,
  MediaResponse,
  UploadSignatureResponse,
  UploadSignatureItem,
  UploadTokenPayload,
} from "./mediaTypes.js";

/**
 * Generates signed upload authorization for direct client-to-Cloudinary upload.
 * All public IDs are strictly server-generated.
 * Overwrite is explicitly disabled in the signed payload.
 * Generates a cryptographically signed, single-use upload authorization token.
 */
export const generateUploadSignature = async (
  input: CreateSignatureInput = {},
  adminId: string,
): Promise<UploadSignatureResponse> => {
  const config = getCloudinaryConfig();
  const cloudinary = getCloudinaryClient();

  const batchSize = Math.max(1, Math.min(input.batchSize || 1, MAX_BATCH_FILES));

  const items: UploadSignatureItem[] = [];

  for (let i = 0; i < batchSize; i++) {
    const timestamp = Math.floor(Date.now() / 1000) + i;
    // Issue 1: Always generate unique, cryptographically random Public IDs on the backend
    const publicId = `tour_${Date.now()}_${randomUUID().replace(/-/g, "")}`;

    // Issue 1: Explicitly include overwrite: false in the signed upload parameters
    const paramsToSign: Record<string, string | number | boolean> = {
      folder: CLOUDINARY_FOLDER,
      overwrite: false,
      public_id: publicId,
      timestamp,
    };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      config.apiSecret,
    );

    // Issue 2: Create a cryptographically signed authorization token bound to adminId, publicId, and folder
    const nonce = randomUUID();
    const uploadToken = jwt.sign(
      {
        adminId,
        publicId,
        folder: CLOUDINARY_FOLDER,
        nonce,
      },
      env.jwtSecret,
      { expiresIn: "1h" },
    );

    const tokenHash = createHash("sha256").update(uploadToken).digest("hex");

    // Persist single-use authorization record to prevent replay attacks
    await createMediaUploadAuthRecord({
      tokenHash,
      publicId,
      folder: CLOUDINARY_FOLDER,
      adminId,
      expiresAt: new Date((timestamp + 3600) * 1000),
    });

    items.push({
      signature,
      timestamp,
      publicId,
      uploadToken,
    });
  }

  const primary = items[0]!;

  return {
    signature: primary.signature,
    timestamp: primary.timestamp,
    apiKey: config.apiKey,
    cloudName: config.cloudName,
    folder: CLOUDINARY_FOLDER,
    publicId: primary.publicId,
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
    maxFileSize: MAX_FILE_SIZE_BYTES,
    allowedFormats: ALLOWED_FORMATS,
    uploadToken: primary.uploadToken,
    ...(batchSize > 1 ? { batch: items } : {}),
  };
};

/**
 * Verifies an uploaded asset via Cloudinary trusted API and persists the Media record.
 * Requires a valid, unconsumed authorization token issued to the requesting admin.
 */
export const confirmUploadedAsset = async (
  input: ConfirmMediaInput,
  userId: string,
): Promise<{ media: MediaResponse; isDuplicate: boolean }> => {
  // 1. Ensure Cloudinary is configured
  getCloudinaryConfig();
  const cloudinary = getCloudinaryClient();

  // 2. Issue 2: Validate upload authorization token signature and claims
  if (!input.uploadToken) {
    throw new AppError("uploadToken is required for asset confirmation", 400);
  }

  let payload: UploadTokenPayload;
  try {
    payload = jwt.verify(input.uploadToken, env.jwtSecret) as UploadTokenPayload;
  } catch (err: any) {
    throw new AppError("Invalid or expired upload authorization token", 401);
  }

  if (payload.adminId !== userId) {
    throw new AppError("Upload authorization belongs to another admin", 403);
  }

  // In Cloudinary, assets stored in CLOUDINARY_FOLDER have the full public ID `${CLOUDINARY_FOLDER}/${leafPublicId}`.
  // When clients confirm, they provide either the exact Cloudinary returned public_id (full path) or the signed leaf ID.
  const fullPublicId = input.publicId.startsWith(`${CLOUDINARY_FOLDER}/`)
    ? input.publicId
    : `${CLOUDINARY_FOLDER}/${input.publicId}`;
  const leafPublicId = input.publicId.startsWith(`${CLOUDINARY_FOLDER}/`)
    ? input.publicId.slice(CLOUDINARY_FOLDER.length + 1)
    : input.publicId;

  const matchesPublicId =
    payload.publicId === input.publicId ||
    payload.publicId === leafPublicId ||
    payload.publicId === fullPublicId ||
    `${payload.folder}/${payload.publicId}` === fullPublicId;

  if (!matchesPublicId) {
    throw new AppError(
      "Upload authorization does not match the provided publicId",
      400,
    );
  }

  if (payload.folder !== CLOUDINARY_FOLDER) {
    throw new AppError("Upload authorization folder mismatch", 400);
  }

  // 3. Validate service association if provided
  if (input.serviceId) {
    const service = await findServiceById(input.serviceId);
    if (!service) {
      throw new AppError("Associated service not found", 404);
    }
  }

  // 4. Idempotency check: check if Media record already exists
  let existing = await findMediaByPublicId(fullPublicId);
  if (!existing && leafPublicId !== fullPublicId) {
    existing = await findMediaByPublicId(leafPublicId);
  }
  if (!existing && input.assetId) {
    existing = await findMediaByAssetId(input.assetId);
  }

  if (existing) {
    // If client supplied a serviceId and existing record does not have one, attach it
    if (input.serviceId && !existing.serviceId) {
      existing = await updateMediaRecord(existing.id, {
        serviceId: input.serviceId,
      });
    }
    return { media: existing, isDuplicate: true };
  }

  // 5. Issue 2: Verify single-use persisted authorization in DB (prevents replay attacks)
  let authRecord = await findMediaUploadAuthByPublicId(leafPublicId);
  if (!authRecord && fullPublicId !== leafPublicId) {
    authRecord = await findMediaUploadAuthByPublicId(fullPublicId);
  }
  if (!authRecord && input.publicId !== leafPublicId && input.publicId !== fullPublicId) {
    authRecord = await findMediaUploadAuthByPublicId(input.publicId);
  }

  if (!authRecord || authRecord.expiresAt < new Date()) {
    throw new AppError("Upload authorization not found or expired", 400);
  }

  if (authRecord.consumedAt) {
    throw new AppError("Upload authorization has already been consumed", 400);
  }

  if (authRecord.adminId !== userId) {
    throw new AppError("Upload authorization belongs to another admin", 403);
  }

  // 6. Fetch asset details directly from Cloudinary trusted API
  // Note: Cloudinary Admin API resource lookup expects the full public ID (including folder)
  let resource: any;
  try {
    resource = await cloudinary.api.resource(fullPublicId, {
      resource_type: "image",
    });
  } catch (err: any) {
    if (fullPublicId !== input.publicId) {
      try {
        resource = await cloudinary.api.resource(input.publicId, {
          resource_type: "image",
        });
      } catch {
        // preserve original error
      }
    }
    if (!resource) {
      const status = err?.error?.http_code || err?.http_code;
      const msg = err?.error?.message || err?.message || "";
      if (status === 404 || /not found/i.test(msg)) {
        throw new AppError("Asset not found in Cloudinary", 404);
      }
      throw new AppError(
        `Failed to verify asset with Cloudinary: ${msg || "Unknown error"}`,
        502,
      );
    }
  }

  // 7. Verify asset belongs to approved folder
  const isApprovedFolder =
    resource.folder === CLOUDINARY_FOLDER ||
    (typeof resource.public_id === "string" &&
      resource.public_id.startsWith(`${CLOUDINARY_FOLDER}/`));

  if (!isApprovedFolder) {
    throw new AppError(
      `Asset outside approved folder. Assets must reside in ${CLOUDINARY_FOLDER}.`,
      400,
    );
  }

  // 8. Verify asset ID if supplied by client
  if (input.assetId && resource.asset_id !== input.assetId) {
    throw new AppError("Asset ID does not match Cloudinary record", 400);
  }

  // 9. Verify resource type is image
  if (resource.resource_type !== "image") {
    throw new AppError(
      "Invalid resource type. Only image uploads are permitted.",
      400,
    );
  }

  // 10. Verify format
  const format = String(resource.format || "").toLowerCase();
  const isAllowedFormat = (ALLOWED_FORMATS as readonly string[]).includes(format);
  if (!isAllowedFormat) {
    throw new AppError(
      `Unsupported image format: "${format || "unknown"}". Accepted formats are JPEG, PNG, WebP, and AVIF.`,
      400,
    );
  }

  // 11. Verify file size
  if (typeof resource.bytes === "number" && resource.bytes > MAX_FILE_SIZE_BYTES) {
    throw new AppError(
      `Asset exceeds maximum permitted size of 10 MB (${resource.bytes} bytes).`,
      400,
    );
  }

  // 12. Persist Media record and atomically consume authorization ticket
  const media = await consumeAuthAndCreateMedia(authRecord.id, {
    assetId: resource.asset_id,
    publicId: resource.public_id,
    secureUrl: resource.secure_url,
    originalFilename:
      resource.original_filename || resource.filename || input.publicId,
    format,
    resourceType: resource.resource_type,
    width: typeof resource.width === "number" ? resource.width : null,
    height: typeof resource.height === "number" ? resource.height : null,
    bytes: resource.bytes,
    folder: resource.folder || CLOUDINARY_FOLDER,
    uploadedById: userId,
    serviceId: input.serviceId || null,
  });

  return { media, isDuplicate: false };
};

/**
 * Retrieves a single media record by ID.
 */
export const getMediaById = async (mediaId: string): Promise<MediaResponse> => {
  const media = await findMediaById(mediaId);
  if (!media) {
    throw new AppError("Media not found", 404);
  }
  return media;
};

/**
 * Retrieves paginated media list for the Admin Media Manager.
 */
export const listMedia = async (
  query: GetMediaQuery,
): Promise<PaginatedMediaResponse> => {
  const page = Number(query.page) || 1;
  const limit = Math.min(Math.max(Number(query.limit) || 24, 1), 100);
  const unattached = query.unattached === "true" || query.unattached === true;

  return listMediaRepo({
    page,
    limit,
    serviceId: query.serviceId,
    unattached,
    search: query.search,
    format: query.format,
    folder: query.folder,
    sortBy: query.sortBy,
  });
};

/**
 * Deletes a media asset after verifying it is not referenced by any tour/service.
 * Issue 3: Checks both Service.metadata references AND direct Media.serviceId relationships.
 */
export const deleteMedia = async (
  mediaId: string,
): Promise<{ id: string; publicId: string }> => {
  // 1. Ensure Cloudinary is configured
  getCloudinaryConfig();
  const cloudinary = getCloudinaryClient();

  // 2. Verify media record exists
  const media = await findMediaById(mediaId);
  if (!media) {
    throw new AppError("Media not found", 404);
  }

  // 3. Issue 3: Verify asset is not referenced by any Tour/Service metadata OR direct serviceId relation
  const referencingServices = await findReferencingServices(
    media.secureUrl,
    media.publicId,
    media.serviceId,
  );

  if (referencingServices.length > 0) {
    const tourNames = referencingServices.map((s) => `"${s.name}"`).join(", ");
    throw new AppError(
      `Cannot delete media: asset is currently referenced by tour(s): ${tourNames}. Remove image references from tours first.`,
      409,
    );
  }

  // 4. Delete asset from Cloudinary
  try {
    const destroyResult = await cloudinary.uploader.destroy(media.publicId, {
      resource_type: "image",
      invalidate: true,
    });

    if (destroyResult.result !== "ok" && destroyResult.result !== "not found") {
      throw new Error(
        `Cloudinary responded with unexpected status: ${destroyResult.result}`,
      );
    }
  } catch (err: any) {
    throw new AppError(
      `Failed to delete asset from Cloudinary: ${err.message || "Unknown error"}`,
      502,
    );
  }

  // 5. Delete database record only after Cloudinary deletion succeeds
  await deleteMediaRecord(media.id);

  return { id: media.id, publicId: media.publicId };
};

/**
 * Bulk deletes multiple media assets safely.
 * Verifies referencing services and entities for each asset, deletes unreferenced assets from Cloudinary and DB,
 * and reports deleted, blocked (skipped due to active references), and failed assets separately.
 */
export const bulkDeleteMedia = async (
  mediaIds: string[],
): Promise<{
  deleted: Array<{ id: string; publicId: string }>;
  blocked: Array<{ id: string; publicId?: string; reason: string }>;
  failed: Array<{ id: string; publicId?: string; reason: string }>;
}> => {
  getCloudinaryConfig();
  const cloudinary = getCloudinaryClient();

  const deleted: Array<{ id: string; publicId: string }> = [];
  const blocked: Array<{ id: string; publicId?: string; reason: string }> = [];
  const failed: Array<{ id: string; publicId?: string; reason: string }> = [];

  for (const mediaId of mediaIds) {
    const media = await findMediaById(mediaId);
    if (!media) {
      failed.push({ id: mediaId, reason: "Media not found in database" });
      continue;
    }

    const referencingServices = await findReferencingServices(
      media.secureUrl,
      media.publicId,
      media.serviceId,
    );

    if (referencingServices.length > 0) {
      const tourNames = referencingServices.map((s) => `"${s.name}"`).join(", ");
      blocked.push({
        id: media.id,
        publicId: media.publicId,
        reason: `Referenced by active entity/tour(s): ${tourNames}`,
      });
      continue;
    }

    try {
      const destroyResult = await cloudinary.uploader.destroy(media.publicId, {
        resource_type: "image",
        invalidate: true,
      });

      if (destroyResult.result !== "ok" && destroyResult.result !== "not found") {
        failed.push({
          id: media.id,
          publicId: media.publicId,
          reason: `Cloudinary error response: ${destroyResult.result}`,
        });
        continue;
      }

      await deleteMediaRecord(media.id);
      deleted.push({ id: media.id, publicId: media.publicId });
    } catch (err: any) {
      failed.push({
        id: media.id,
        publicId: media.publicId,
        reason: err.message || "Failed to delete from Cloudinary",
      });
    }
  }

  return { deleted, blocked, failed };
};

/**
 * Bulk attaches or detaches media records to/from a Service.
 */
export const bulkAttachDetachMedia = async (input: {
  mediaIds: string[];
  action: "attach" | "detach";
  serviceId?: string | null;
}): Promise<{
  updatedCount: number;
  items: MediaResponse[];
}> => {
  const { mediaIds, action, serviceId } = input;

  if (action === "attach") {
    if (!serviceId) {
      throw new AppError("serviceId is required when attaching media", 400);
    }
    const service = await findServiceById(serviceId);
    if (!service) {
      throw new AppError("Target service not found", 404);
    }
  }

  const targetServiceId = action === "attach" ? serviceId! : null;

  const items: MediaResponse[] = [];
  for (const mediaId of mediaIds) {
    const existing = await findMediaById(mediaId);
    if (existing) {
      const updated = await updateMediaRecord(mediaId, {
        serviceId: targetServiceId,
      });
      items.push(updated);
    }
  }

  return { updatedCount: items.length, items };
};

/**
 * Synchronizes single media asset metadata from Cloudinary.
 * Handles deleted or unavailable Cloudinary assets gracefully.
 */
export const syncAssetFromCloudinary = async (
  mediaId: string,
): Promise<{
  media: MediaResponse | null;
  status: "synced" | "missing_on_cloudinary";
}> => {
  getCloudinaryConfig();
  const cloudinary = getCloudinaryClient();

  const media = await findMediaById(mediaId);
  if (!media) {
    throw new AppError("Media not found in database", 404);
  }

  let resource: any;
  try {
    resource = await cloudinary.api.resource(media.publicId, {
      resource_type: "image",
    });
  } catch (err: any) {
    if (err?.error?.http_code === 404 || err?.http_code === 404) {
      return { media, status: "missing_on_cloudinary" };
    }
    throw new AppError(
      `Cloudinary sync error: ${err.message || "Unknown error"}`,
      502,
    );
  }

  const updated = await updateMediaRecord(media.id, {
    format: resource.format || media.format,
    bytes: resource.bytes || media.bytes,
    width: typeof resource.width === "number" ? resource.width : media.width,
    height: typeof resource.height === "number" ? resource.height : media.height,
    secureUrl: resource.secure_url || media.secureUrl,
  });

  return { media: updated, status: "synced" };
};
