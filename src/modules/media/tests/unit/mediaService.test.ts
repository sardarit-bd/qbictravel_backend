import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";
import env from "../../../../config/env.js";
import AppError from "../../../../shared/utils/AppError.js";
import * as mediaRepository from "../../mediaRepository.js";
import * as mediaService from "../../mediaService.js";

vi.mock("../../mediaRepository.js");
vi.mock("../../../../config/cloudinary.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../config/cloudinary.js")>();
  return {
    ...actual,
    getCloudinaryClient: vi.fn(),
    getCloudinaryConfig: vi.fn(),
  };
});

import {
  getCloudinaryClient,
  getCloudinaryConfig,
} from "../../../../config/cloudinary.js";

const mockedRepo = vi.mocked(mediaRepository);
const mockedGetConfig = vi.mocked(getCloudinaryConfig);
const mockedGetClient = vi.mocked(getCloudinaryClient);

describe("Media Service Unit Tests — Security Hardened", () => {
  const fakeConfig = {
    cloudName: "mock-cloud",
    apiKey: "mock-key",
    apiSecret: "mock-secret",
  };

  const fakeCloudinary = {
    utils: {
      api_sign_request: vi.fn().mockReturnValue("mocked-sha1-signature"),
    },
    api: {
      resource: vi.fn(),
    },
    uploader: {
      destroy: vi.fn(),
    },
  };

  const adminId = "admin-uuid-1";

  const createValidToken = (
    overrides: Partial<{
      adminId: string;
      publicId: string;
      folder: string;
      nonce: string;
      expiresIn: string;
    }> = {},
  ) => {
    return jwt.sign(
      {
        adminId: overrides.adminId ?? adminId,
        publicId: overrides.publicId ?? "phukettours/tours/valid-img",
        folder: overrides.folder ?? "phukettours/tours",
        nonce: overrides.nonce ?? randomUUID(),
      },
      env.jwtSecret,
      { expiresIn: (overrides.expiresIn ?? "1h") as any },
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetConfig.mockReturnValue(fakeConfig);
    mockedGetClient.mockReturnValue(fakeCloudinary as any);
  });

  describe("Configuration checks", () => {
    it("throws 503 AppError if Cloudinary configuration is missing on signature generation", async () => {
      mockedGetConfig.mockImplementation(() => {
        throw new AppError(
          "Cloudinary media service is not configured. Missing required environment variables.",
          503,
        );
      });

      await expect(
        mediaService.generateUploadSignature({}, adminId),
      ).rejects.toThrow(/Cloudinary media service is not configured/);
    });

    it("throws 503 AppError if Cloudinary configuration is missing on asset confirmation", async () => {
      mockedGetConfig.mockImplementation(() => {
        throw new AppError(
          "Cloudinary media service is not configured. Missing required environment variables.",
          503,
        );
      });

      await expect(
        mediaService.confirmUploadedAsset(
          {
            publicId: "phukettours/tours/test",
            uploadToken: "some-token",
          },
          adminId,
        ),
      ).rejects.toThrow(/Cloudinary media service is not configured/);
    });

    it("throws 503 AppError if Cloudinary configuration is missing on deletion", async () => {
      mockedGetConfig.mockImplementation(() => {
        throw new AppError(
          "Cloudinary media service is not configured. Missing required environment variables.",
          503,
        );
      });

      await expect(mediaService.deleteMedia("media-1")).rejects.toThrow(
        /Cloudinary media service is not configured/,
      );
    });
  });

  describe("Issue 1: Public ID Overwrite Prevention & Signature Generation", () => {
    it("always generates a unique server-controlled public ID and signs overwrite: false", async () => {
      const result = await mediaService.generateUploadSignature({}, adminId);

      expect(result).toMatchObject({
        signature: "mocked-sha1-signature",
        apiKey: fakeConfig.apiKey,
        cloudName: fakeConfig.cloudName,
        folder: "phukettours/tours",
        uploadUrl: `https://api.cloudinary.com/v1_1/${fakeConfig.cloudName}/image/upload`,
        maxFileSize: 10485760,
      });

      expect(result.publicId).toMatch(/^tour_\d+_[a-f0-9]{32}$/);
      expect(result.uploadToken).toBeDefined();

      // Verify overwrite: false is strictly signed
      expect(fakeCloudinary.utils.api_sign_request).toHaveBeenCalledWith(
        expect.objectContaining({
          folder: "phukettours/tours",
          overwrite: false,
          public_id: result.publicId,
          timestamp: result.timestamp,
        }),
        fakeConfig.apiSecret,
      );

      // Verify authorization record was persisted
      expect(mockedRepo.createMediaUploadAuthRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          publicId: result.publicId,
          adminId,
          folder: "phukettours/tours",
        }),
      );
    });

    it("generates different unique public IDs on consecutive calls", async () => {
      const res1 = await mediaService.generateUploadSignature({}, adminId);
      const res2 = await mediaService.generateUploadSignature({}, adminId);

      expect(res1.publicId).not.toEqual(res2.publicId);
      expect(res1.uploadToken).not.toEqual(res2.uploadToken);
    });

    it("generates batch signatures with unique public IDs and tokens", async () => {
      const result = await mediaService.generateUploadSignature(
        { batchSize: 3 },
        adminId,
      );

      expect(result.batch).toBeDefined();
      expect(result.batch).toHaveLength(3);
      expect(fakeCloudinary.utils.api_sign_request).toHaveBeenCalledTimes(3);
      expect(mockedRepo.createMediaUploadAuthRecord).toHaveBeenCalledTimes(3);

      const publicIds = result.batch!.map((b) => b.publicId);
      const uniqueIds = new Set(publicIds);
      expect(uniqueIds.size).toBe(3);
    });
  });

  describe("Issue 2: Upload Authorization & Confirmation Binding", () => {
    const validCloudinaryResource = {
      asset_id: "cld-asset-123",
      public_id: "phukettours/tours/valid-img",
      secure_url: "https://res.cloudinary.com/mock-cloud/image/upload/v1/valid.jpg",
      original_filename: "my-photo",
      format: "jpg",
      resource_type: "image",
      bytes: 204800,
      width: 1920,
      height: 1080,
      folder: "phukettours/tours",
    };

    const validAuthRecord = {
      id: "auth-record-1",
      tokenHash: "hashed-token",
      publicId: "phukettours/tours/valid-img",
      folder: "phukettours/tours",
      adminId,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 3600 * 1000),
      createdAt: new Date(),
    };

    it("rejects confirmation when uploadToken is missing or invalid", async () => {
      await expect(
        mediaService.confirmUploadedAsset(
          {
            publicId: "phukettours/tours/valid-img",
            uploadToken: "malformed-garbage-token",
          },
          adminId,
        ),
      ).rejects.toThrow(/Invalid or expired upload authorization token/);
    });

    it("rejects confirmation when uploadToken is expired", async () => {
      const expiredToken = createValidToken({ expiresIn: "-10s" });

      await expect(
        mediaService.confirmUploadedAsset(
          {
            publicId: "phukettours/tours/valid-img",
            uploadToken: expiredToken,
          },
          adminId,
        ),
      ).rejects.toThrow(/Invalid or expired upload authorization token/);
    });

    it("rejects confirmation when uploadToken belongs to another admin", async () => {
      const otherAdminToken = createValidToken({ adminId: "other-admin-uuid" });

      await expect(
        mediaService.confirmUploadedAsset(
          {
            publicId: "phukettours/tours/valid-img",
            uploadToken: otherAdminToken,
          },
          adminId,
        ),
      ).rejects.toThrow(/Upload authorization belongs to another admin/);
    });

    it("rejects confirmation when uploadToken publicId does not match input publicId", async () => {
      const mismatchedToken = createValidToken({
        publicId: "phukettours/tours/different-img",
      });

      await expect(
        mediaService.confirmUploadedAsset(
          {
            publicId: "phukettours/tours/valid-img",
            uploadToken: mismatchedToken,
          },
          adminId,
        ),
      ).rejects.toThrow(/Upload authorization does not match the provided publicId/);
    });

    it("rejects confirmation when upload authorization record is not found in database", async () => {
      const validToken = createValidToken();
      mockedRepo.findMediaByPublicId.mockResolvedValue(null);
      mockedRepo.findMediaUploadAuthByPublicId.mockResolvedValue(null);

      await expect(
        mediaService.confirmUploadedAsset(
          {
            publicId: "phukettours/tours/valid-img",
            uploadToken: validToken,
          },
          adminId,
        ),
      ).rejects.toThrow(/Upload authorization not found or expired/);
    });

    it("rejects confirmation if authorization record has already been consumed (replay attack)", async () => {
      const validToken = createValidToken();
      mockedRepo.findMediaByPublicId.mockResolvedValue(null);
      mockedRepo.findMediaUploadAuthByPublicId.mockResolvedValue({
        ...validAuthRecord,
        consumedAt: new Date(Date.now() - 5000), // Already consumed!
      });

      await expect(
        mediaService.confirmUploadedAsset(
          {
            publicId: "phukettours/tours/valid-img",
            uploadToken: validToken,
          },
          adminId,
        ),
      ).rejects.toThrow(/Upload authorization has already been consumed/);
    });

    it("returns existing media record idempotently without re-creating", async () => {
      const validToken = createValidToken();
      const existingMedia = {
        id: "m-existing",
        assetId: "cld-asset-123",
        publicId: "phukettours/tours/valid-img",
        secureUrl: "https://res.cloudinary.com/...",
        serviceId: null,
      } as any;

      mockedRepo.findMediaByPublicId.mockResolvedValue(existingMedia);

      const result = await mediaService.confirmUploadedAsset(
        {
          publicId: "phukettours/tours/valid-img",
          uploadToken: validToken,
          assetId: "cld-asset-123",
        },
        adminId,
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.media).toBe(existingMedia);
      expect(fakeCloudinary.api.resource).not.toHaveBeenCalled();
      expect(mockedRepo.consumeAuthAndCreateMedia).not.toHaveBeenCalled();
    });

    it("throws 404 if associated serviceId does not exist", async () => {
      const validToken = createValidToken();
      mockedRepo.findMediaByPublicId.mockResolvedValue(null);
      mockedRepo.findServiceById.mockResolvedValue(null);

      await expect(
        mediaService.confirmUploadedAsset(
          {
            publicId: "phukettours/tours/valid-img",
            uploadToken: validToken,
            serviceId: "non-existent-service",
          },
          adminId,
        ),
      ).rejects.toThrow(/Associated service not found/);
    });

    it("throws 404 if asset not found in Cloudinary", async () => {
      const validToken = createValidToken();
      mockedRepo.findMediaByPublicId.mockResolvedValue(null);
      mockedRepo.findMediaUploadAuthByPublicId.mockResolvedValue(validAuthRecord);
      fakeCloudinary.api.resource.mockRejectedValue({
        error: { http_code: 404, message: "Resource not found" },
      });

      await expect(
        mediaService.confirmUploadedAsset(
          {
            publicId: "phukettours/tours/valid-img",
            uploadToken: validToken,
          },
          adminId,
        ),
      ).rejects.toThrow(/Asset not found in Cloudinary/);
    });

    it("throws 400 if asset is outside approved folder", async () => {
      const validToken = createValidToken();
      mockedRepo.findMediaByPublicId.mockResolvedValue(null);
      mockedRepo.findMediaUploadAuthByPublicId.mockResolvedValue(validAuthRecord);
      fakeCloudinary.api.resource.mockResolvedValue({
        ...validCloudinaryResource,
        folder: "unauthorized_folder",
        public_id: "unauthorized_folder/hacked-pic",
      });

      await expect(
        mediaService.confirmUploadedAsset(
          {
            publicId: "phukettours/tours/valid-img",
            uploadToken: validToken,
          },
          adminId,
        ),
      ).rejects.toThrow(/Asset outside approved folder/);
    });

    it("throws 400 if asset ID mismatch", async () => {
      const validToken = createValidToken();
      mockedRepo.findMediaByPublicId.mockResolvedValue(null);
      mockedRepo.findMediaUploadAuthByPublicId.mockResolvedValue(validAuthRecord);
      fakeCloudinary.api.resource.mockResolvedValue(validCloudinaryResource);

      await expect(
        mediaService.confirmUploadedAsset(
          {
            publicId: "phukettours/tours/valid-img",
            uploadToken: validToken,
            assetId: "mismatched-asset-id",
          },
          adminId,
        ),
      ).rejects.toThrow(/Asset ID does not match/);
    });

    it("throws 400 if format is unsupported (e.g. svg)", async () => {
      const validToken = createValidToken();
      mockedRepo.findMediaByPublicId.mockResolvedValue(null);
      mockedRepo.findMediaUploadAuthByPublicId.mockResolvedValue(validAuthRecord);
      fakeCloudinary.api.resource.mockResolvedValue({
        ...validCloudinaryResource,
        format: "svg",
      });

      await expect(
        mediaService.confirmUploadedAsset(
          {
            publicId: "phukettours/tours/valid-img",
            uploadToken: validToken,
          },
          adminId,
        ),
      ).rejects.toThrow(/Unsupported image format: "svg"/);
    });

    it("throws 400 if asset size exceeds 10 MB", async () => {
      const validToken = createValidToken();
      mockedRepo.findMediaByPublicId.mockResolvedValue(null);
      mockedRepo.findMediaUploadAuthByPublicId.mockResolvedValue(validAuthRecord);
      fakeCloudinary.api.resource.mockResolvedValue({
        ...validCloudinaryResource,
        bytes: 12 * 1024 * 1024,
      });

      await expect(
        mediaService.confirmUploadedAsset(
          {
            publicId: "phukettours/tours/valid-img",
            uploadToken: validToken,
          },
          adminId,
        ),
      ).rejects.toThrow(/Asset exceeds maximum permitted size of 10 MB/);
    });

    it("atomically consumes authorization and creates media record upon valid confirmation", async () => {
      const validToken = createValidToken();
      mockedRepo.findMediaByPublicId.mockResolvedValue(null);
      mockedRepo.findMediaByAssetId.mockResolvedValue(null);
      mockedRepo.findMediaUploadAuthByPublicId.mockResolvedValue(validAuthRecord);
      fakeCloudinary.api.resource.mockResolvedValue(validCloudinaryResource);

      const createdMedia = {
        id: "media-uuid",
        ...validCloudinaryResource,
        uploadedById: adminId,
        serviceId: null,
      } as any;
      mockedRepo.consumeAuthAndCreateMedia.mockResolvedValue(createdMedia);

      const result = await mediaService.confirmUploadedAsset(
        {
          publicId: "phukettours/tours/valid-img",
          uploadToken: validToken,
          assetId: "cld-asset-123",
        },
        adminId,
      );

      expect(result.isDuplicate).toBe(false);
      expect(result.media).toBe(createdMedia);
      expect(mockedRepo.consumeAuthAndCreateMedia).toHaveBeenCalledWith(
        validAuthRecord.id,
        expect.objectContaining({
          assetId: "cld-asset-123",
          publicId: "phukettours/tours/valid-img",
          folder: "phukettours/tours",
          uploadedById: adminId,
        }),
      );
    });
  });

  describe("listMedia", () => {
    it("calls repository with parsed pagination and filter parameters", async () => {
      const mockList = {
        items: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
      };
      mockedRepo.listMedia.mockResolvedValue(mockList as any);

      const result = await mediaService.listMedia({
        page: 2,
        limit: 10,
        unattached: "true",
      });

      expect(mockedRepo.listMedia).toHaveBeenCalledWith({
        page: 2,
        limit: 10,
        serviceId: undefined,
        unattached: true,
        search: undefined,
      });
      expect(result).toBe(mockList);
    });
  });

  describe("Issue 3: Media Deletion Safety & Service Reference Checks", () => {
    const existingMedia = {
      id: "media-to-del",
      publicId: "phukettours/tours/del-img",
      secureUrl: "https://res.cloudinary.com/del.jpg",
      serviceId: null,
    } as any;

    it("throws 404 if media record does not exist", async () => {
      mockedRepo.findMediaById.mockResolvedValue(null);

      await expect(mediaService.deleteMedia("missing-id")).rejects.toThrow(
        /Media not found/,
      );
    });

    it("throws 409 if media is directly associated with a Service through serviceId", async () => {
      const mediaWithService = {
        ...existingMedia,
        serviceId: "service-uuid-456",
      };
      mockedRepo.findMediaById.mockResolvedValue(mediaWithService);
      mockedRepo.findReferencingServices.mockResolvedValue([
        { id: "service-uuid-456", name: "Phuket Luxury Yacht Tour" },
      ]);

      await expect(
        mediaService.deleteMedia(mediaWithService.id),
      ).rejects.toThrow(
        /currently referenced by tour\(s\): "Phuket Luxury Yacht Tour"/,
      );
      expect(mockedRepo.findReferencingServices).toHaveBeenCalledWith(
        mediaWithService.secureUrl,
        mediaWithService.publicId,
        "service-uuid-456",
      );
      expect(fakeCloudinary.uploader.destroy).not.toHaveBeenCalled();
      expect(mockedRepo.deleteMediaRecord).not.toHaveBeenCalled();
    });

    it("throws 409 if media is referenced by Tour metadata (featuredImage or images)", async () => {
      mockedRepo.findMediaById.mockResolvedValue(existingMedia);
      mockedRepo.findReferencingServices.mockResolvedValue([
        { id: "s-1", name: "Phi Phi Island Luxury Tour" },
      ]);

      await expect(
        mediaService.deleteMedia(existingMedia.id),
      ).rejects.toThrow(
        /currently referenced by tour\(s\): "Phi Phi Island Luxury Tour"/,
      );
      expect(fakeCloudinary.uploader.destroy).not.toHaveBeenCalled();
      expect(mockedRepo.deleteMediaRecord).not.toHaveBeenCalled();
    });

    it("throws 502 if Cloudinary destruction fails", async () => {
      mockedRepo.findMediaById.mockResolvedValue(existingMedia);
      mockedRepo.findReferencingServices.mockResolvedValue([]);
      fakeCloudinary.uploader.destroy.mockRejectedValue(
        new Error("Network timeout"),
      );

      await expect(
        mediaService.deleteMedia(existingMedia.id),
      ).rejects.toThrow(/Failed to delete asset from Cloudinary/);
      expect(mockedRepo.deleteMediaRecord).not.toHaveBeenCalled();
    });

    it("deletes from Cloudinary and removes database record when unattached", async () => {
      mockedRepo.findMediaById.mockResolvedValue(existingMedia);
      mockedRepo.findReferencingServices.mockResolvedValue([]);
      fakeCloudinary.uploader.destroy.mockResolvedValue({ result: "ok" });
      mockedRepo.deleteMediaRecord.mockResolvedValue(undefined);

      const result = await mediaService.deleteMedia(existingMedia.id);

      expect(result).toEqual({
        id: existingMedia.id,
        publicId: existingMedia.publicId,
      });
      expect(fakeCloudinary.uploader.destroy).toHaveBeenCalledWith(
        existingMedia.publicId,
        {
          resource_type: "image",
          invalidate: true,
        },
      );
      expect(mockedRepo.deleteMediaRecord).toHaveBeenCalledWith(
        existingMedia.id,
      );
    });
  });
});
