import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { v2 as cloudinary } from "cloudinary";
import env from "../../../../config/env.js";
import {
  api,
  createUser,
  loginAgent,
  prisma,
  resetDatabase,
} from "../../../../test/helpers.js";

vi.mock("cloudinary", () => {
  return {
    v2: {
      config: vi.fn(),
      utils: {
        api_sign_request: vi.fn().mockReturnValue("mocked-sha1-signature"),
      },
      api: {
        resource: vi.fn(),
      },
      uploader: {
        destroy: vi.fn(),
      },
    },
  };
});

const MEDIA_BASE = "/api/v1/admin/media";

type Session = Awaited<ReturnType<typeof loginAgent>>;
let admin: Awaited<ReturnType<typeof createUser>>;
let otherAdmin: Awaited<ReturnType<typeof createUser>>;
let adminSession: Session;
let otherAdminSession: Session;

describe("Admin Media Routes Integration Tests — Security Hardened", () => {
  beforeEach(async () => {
    await resetDatabase();
    process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
    process.env.CLOUDINARY_API_KEY = "test-key";
    process.env.CLOUDINARY_API_SECRET = "test-secret";

    admin = await createUser({ role: "admin", name: "Admin User" });
    adminSession = await loginAgent(admin.email);

    vi.clearAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("Access Control", () => {
    it("returns 401 unauthorized on all endpoints without authentication", async () => {
      expect((await api().post(`${MEDIA_BASE}/signature`).send({})).status).toBe(
        401,
      );
      expect((await api().post(`${MEDIA_BASE}/confirm`).send({})).status).toBe(
        401,
      );
      expect((await api().get(MEDIA_BASE)).status).toBe(401);
      expect(
        (await api().delete(`${MEDIA_BASE}/${randomUUID()}`)).status,
      ).toBe(401);
    });

    it.each(["customer", "agent", "staff"] as const)(
      "returns 403 forbidden for %s role",
      async (role) => {
        const user = await createUser({ role });
        const session = await loginAgent(user.email);

        expect(
          (await session.post(`${MEDIA_BASE}/signature`).send({})).status,
        ).toBe(403);
        expect(
          (await session.post(`${MEDIA_BASE}/confirm`).send({})).status,
        ).toBe(403);
        expect((await session.get(MEDIA_BASE)).status).toBe(403);
        expect(
          (await session.delete(`${MEDIA_BASE}/${randomUUID()}`)).status,
        ).toBe(403);
      },
    );
  });

  describe("Issue 1: POST /api/v1/admin/media/signature (Overwrite Prevention & Unique IDs)", () => {
    it("generates signed upload authorization and uploadToken with overwrite: false", async () => {
      const res = await adminSession.post(`${MEDIA_BASE}/signature`).send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        signature: "mocked-sha1-signature",
        apiKey: "test-key",
        cloudName: "test-cloud",
        folder: "phukettours/tours",
        uploadUrl: "https://api.cloudinary.com/v1_1/test-cloud/image/upload",
        maxFileSize: 10485760,
      });

      expect(res.body.data.publicId).toMatch(/^tour_\d+_[a-f0-9]{32}$/);
      expect(res.body.data.uploadToken).toBeDefined();

      // Verify Cloudinary signed parameters strictly included overwrite: false
      expect(cloudinary.utils.api_sign_request).toHaveBeenCalledWith(
        expect.objectContaining({
          folder: "phukettours/tours",
          overwrite: false,
          public_id: res.body.data.publicId,
          timestamp: res.body.data.timestamp,
        }),
        "test-secret",
      );

      // Verify authorization record exists in DB
      const authRecord = await prisma.mediaUploadAuth.findUnique({
        where: { publicId: res.body.data.publicId },
      });
      expect(authRecord).not.toBeNull();
      expect(authRecord?.adminId).toBe(admin.id);
      expect(authRecord?.consumedAt).toBeNull();
    });

    it("rejects client attempts to provide a custom publicId", async () => {
      const res = await adminSession
        .post(`${MEDIA_BASE}/signature`)
        .send({ publicId: "malicious_overwrite_hero" });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Custom publicId is not permitted");
    });

    it("generates distinct unique public IDs and tokens on multiple calls", async () => {
      const res1 = await adminSession.post(`${MEDIA_BASE}/signature`).send({});
      const res2 = await adminSession.post(`${MEDIA_BASE}/signature`).send({});

      expect(res1.body.data.publicId).not.toEqual(res2.body.data.publicId);
      expect(res1.body.data.uploadToken).not.toEqual(res2.body.data.uploadToken);
    });

    it("rejects batchSize exceeding 10", async () => {
      const res = await adminSession
        .post(`${MEDIA_BASE}/signature`)
        .send({ batchSize: 15 });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("batchSize cannot exceed 10");
    });

    it("rejects unauthorized custom folders outside phukettours/tours", async () => {
      const res = await adminSession
        .post(`${MEDIA_BASE}/signature`)
        .send({ folder: "malicious_folder" });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Folder must be phukettours/tours");
    });

    it("returns 503 when Cloudinary credentials are not configured", async () => {
      delete process.env.CLOUDINARY_API_KEY;

      const res = await adminSession.post(`${MEDIA_BASE}/signature`).send({});

      expect(res.status).toBe(503);
      expect(res.body.message).toContain("Cloudinary media service is not configured");
    });
  });

  describe("Issue 2: POST /api/v1/admin/media/confirm (Authorization Binding & Single-Use)", () => {
    const validCloudinaryResponse = {
      asset_id: "cld-asset-test-999",
      public_id: "phukettours/tours/tour_sample_123",
      secure_url: "https://res.cloudinary.com/test-cloud/image/upload/v1/tour_sample_123.webp",
      original_filename: "phuket-beach.webp",
      format: "webp",
      resource_type: "image",
      bytes: 524288,
      width: 1600,
      height: 900,
      folder: "phukettours/tours",
    };

    it("successfully confirms upload with a valid authorization token and atomically consumes it", async () => {
      // 1. Generate signature first to get publicId & uploadToken
      const sigRes = await adminSession.post(`${MEDIA_BASE}/signature`).send({});
      const { publicId, uploadToken } = sigRes.body.data;

      vi.mocked(cloudinary.api.resource).mockResolvedValue({
        ...validCloudinaryResponse,
        public_id: publicId,
      } as any);

      // 2. Confirm asset with valid token
      const res = await adminSession.post(`${MEDIA_BASE}/confirm`).send({
        publicId,
        uploadToken,
        assetId: "cld-asset-test-999",
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        publicId,
        uploadedById: admin.id,
        format: "webp",
      });

      // 3. Verify auth record is now marked consumed in database
      const authRecord = await prisma.mediaUploadAuth.findUnique({
        where: { publicId },
      });
      expect(authRecord?.consumedAt).not.toBeNull();
    });

    it("successfully confirms upload with full Cloudinary public_id returned by Cloudinary upload", async () => {
      const sigRes = await adminSession.post(`${MEDIA_BASE}/signature`).send({});
      const { publicId: leafPublicId, uploadToken } = sigRes.body.data;
      const fullPublicId = `phukettours/tours/${leafPublicId}`;

      vi.mocked(cloudinary.api.resource).mockResolvedValue({
        ...validCloudinaryResponse,
        public_id: fullPublicId,
      } as any);

      const res = await adminSession.post(`${MEDIA_BASE}/confirm`).send({
        publicId: fullPublicId,
        uploadToken,
        assetId: "cld-asset-test-999",
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        publicId: fullPublicId,
        uploadedById: admin.id,
      });

      const authRecord = await prisma.mediaUploadAuth.findUnique({
        where: { publicId: leafPublicId },
      });
      expect(authRecord?.consumedAt).not.toBeNull();
    });

    it("rejects confirmation when uploadToken is missing", async () => {
      const res = await adminSession.post(`${MEDIA_BASE}/confirm`).send({
        publicId: "phukettours/tours/sample",
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("uploadToken is required");
    });

    it("rejects confirmation when uploadToken is invalid or tampered", async () => {
      const res = await adminSession.post(`${MEDIA_BASE}/confirm`).send({
        publicId: "phukettours/tours/sample",
        uploadToken: "invalid.tampered.token",
      });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain("Invalid or expired upload authorization token");
    });

    it("rejects confirmation when uploadToken is expired", async () => {
      const expiredToken = jwt.sign(
        {
          adminId: admin.id,
          publicId: "phukettours/tours/sample",
          folder: "phukettours/tours",
          nonce: randomUUID(),
        },
        env.jwtSecret,
        { expiresIn: "-10s" },
      );

      const res = await adminSession.post(`${MEDIA_BASE}/confirm`).send({
        publicId: "phukettours/tours/sample",
        uploadToken: expiredToken,
      });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain("Invalid or expired upload authorization token");
    });

    it("rejects confirmation when uploadToken belongs to another admin", async () => {
      const otherAdmin = await createUser({ role: "admin", name: "Other Admin" });
      const otherAdminSession = await loginAgent(otherAdmin.email);

      // Generated by otherAdmin
      const sigRes = await otherAdminSession
        .post(`${MEDIA_BASE}/signature`)
        .send({});
      const { publicId, uploadToken } = sigRes.body.data;

      // Current admin tries to confirm it
      const res = await adminSession.post(`${MEDIA_BASE}/confirm`).send({
        publicId,
        uploadToken,
      });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Upload authorization belongs to another admin");
    });

    it("rejects confirmation when uploadToken publicId does not match input publicId", async () => {
      const sigRes = await adminSession.post(`${MEDIA_BASE}/signature`).send({});
      const { uploadToken } = sigRes.body.data;

      const res = await adminSession.post(`${MEDIA_BASE}/confirm`).send({
        publicId: "phukettours/tours/unauthorized_other_id",
        uploadToken,
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain(
        "Upload authorization does not match the provided publicId",
      );
    });

    it("rejects replay attacks when an authorization record was already consumed", async () => {
      const sigRes = await adminSession.post(`${MEDIA_BASE}/signature`).send({});
      const { publicId, uploadToken } = sigRes.body.data;

      vi.mocked(cloudinary.api.resource).mockResolvedValue({
        ...validCloudinaryResponse,
        public_id: publicId,
      } as any);

      // Confirm once
      await adminSession.post(`${MEDIA_BASE}/confirm`).send({
        publicId,
        uploadToken,
      });

      // Manually delete the Media record from DB to simulate replaying the same auth token for a second asset
      await prisma.media.delete({ where: { publicId } });

      // Attempt second confirmation with same token
      const replayRes = await adminSession.post(`${MEDIA_BASE}/confirm`).send({
        publicId,
        uploadToken,
      });

      expect(replayRes.status).toBe(400);
      expect(replayRes.body.message).toContain("already been consumed");
    });

    it("handles duplicate confirmation requests idempotently with 200 without recreating", async () => {
      const sigRes = await adminSession.post(`${MEDIA_BASE}/signature`).send({});
      const { publicId, uploadToken } = sigRes.body.data;

      vi.mocked(cloudinary.api.resource).mockResolvedValue({
        ...validCloudinaryResponse,
        public_id: publicId,
      } as any);

      // First confirmation creates record (201)
      const firstRes = await adminSession.post(`${MEDIA_BASE}/confirm`).send({
        publicId,
        uploadToken,
      });
      expect(firstRes.status).toBe(201);

      // Second confirmation returns existing record idempotently (200)
      const secondRes = await adminSession.post(`${MEDIA_BASE}/confirm`).send({
        publicId,
        uploadToken,
      });
      expect(secondRes.status).toBe(200);
      expect(secondRes.body.message).toContain("already confirmed");
      expect(secondRes.body.data.id).toBe(firstRes.body.data.id);
    });

    it("allows associating media with a Tour service", async () => {
      const tour = await prisma.service.create({
        data: {
          name: "James Bond Island Tour",
          type: "TOUR",
          status: "PUBLISHED",
        },
      });

      const sigRes = await adminSession.post(`${MEDIA_BASE}/signature`).send({});
      const { publicId, uploadToken } = sigRes.body.data;

      vi.mocked(cloudinary.api.resource).mockResolvedValue({
        ...validCloudinaryResponse,
        public_id: publicId,
      } as any);

      const res = await adminSession.post(`${MEDIA_BASE}/confirm`).send({
        publicId,
        uploadToken,
        serviceId: tour.id,
      });

      expect(res.status).toBe(201);
      expect(res.body.data.serviceId).toBe(tour.id);
      expect(res.body.data.service.name).toBe("James Bond Island Tour");
    });
  });

  describe("GET /api/v1/admin/media", () => {
    it("returns paginated list of media with unattached and service filters", async () => {
      const tour = await prisma.service.create({
        data: {
          name: "Similan Islands Snorkeling",
          type: "TOUR",
        },
      });

      await prisma.media.createMany({
        data: [
          {
            assetId: "ast-1",
            publicId: "phukettours/tours/pic1",
            secureUrl: "https://res.cloudinary.com/pic1.jpg",
            format: "jpg",
            resourceType: "image",
            bytes: 1000,
            folder: "phukettours/tours",
            uploadedById: admin.id,
            serviceId: tour.id,
          },
          {
            assetId: "ast-2",
            publicId: "phukettours/tours/pic2",
            secureUrl: "https://res.cloudinary.com/pic2.png",
            format: "png",
            resourceType: "image",
            bytes: 2000,
            folder: "phukettours/tours",
            uploadedById: admin.id,
            serviceId: null,
          },
        ],
      });

      // 1. List all
      const allRes = await adminSession.get(MEDIA_BASE);
      expect(allRes.status).toBe(200);
      expect(allRes.body.data.items).toHaveLength(2);
      expect(allRes.body.data.pagination.total).toBe(2);

      // 2. Filter unattached
      const unattachedRes = await adminSession
        .get(MEDIA_BASE)
        .query({ unattached: "true" });
      expect(unattachedRes.status).toBe(200);
      expect(unattachedRes.body.data.items).toHaveLength(1);
      expect(unattachedRes.body.data.items[0].publicId).toBe(
        "phukettours/tours/pic2",
      );

      // 3. Filter by serviceId
      const serviceRes = await adminSession
        .get(MEDIA_BASE)
        .query({ serviceId: tour.id });
      expect(serviceRes.status).toBe(200);
      expect(serviceRes.body.data.items).toHaveLength(1);
      expect(serviceRes.body.data.items[0].publicId).toBe(
        "phukettours/tours/pic1",
      );
    });
  });

  describe("Issue 3: DELETE /api/v1/admin/media/:mediaId (Service Reference Protection)", () => {
    it("returns 404 if media does not exist", async () => {
      const res = await adminSession.delete(`${MEDIA_BASE}/${randomUUID()}`);
      expect(res.status).toBe(404);
      expect(res.body.message).toContain("Media not found");
    });

    it("blocks deletion if media is directly associated through serviceId", async () => {
      const tour = await prisma.service.create({
        data: {
          name: "Directly Linked Tour",
          type: "TOUR",
          metadata: {}, // Empty metadata, relation is via serviceId only
        },
      });

      const media = await prisma.media.create({
        data: {
          assetId: "dir-ast-1",
          publicId: "phukettours/tours/direct_service_pic",
          secureUrl: "https://res.cloudinary.com/test-cloud/image/upload/direct.jpg",
          format: "jpg",
          bytes: 1000,
          folder: "phukettours/tours",
          uploadedById: admin.id,
          serviceId: tour.id,
        },
      });

      const res = await adminSession.delete(`${MEDIA_BASE}/${media.id}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain("Directly Linked Tour");
      expect(cloudinary.uploader.destroy).not.toHaveBeenCalled();

      // Ensure record still exists
      const dbRecord = await prisma.media.findUnique({ where: { id: media.id } });
      expect(dbRecord).not.toBeNull();
    });

    it("blocks deletion if media is referenced in Tour metadata.featuredImage", async () => {
      const media = await prisma.media.create({
        data: {
          assetId: "ref-feat-1",
          publicId: "phukettours/tours/featured_hero_pic",
          secureUrl: "https://res.cloudinary.com/test-cloud/image/upload/feat.jpg",
          format: "jpg",
          bytes: 1000,
          folder: "phukettours/tours",
          uploadedById: admin.id,
        },
      });

      await prisma.service.create({
        data: {
          name: "Featured Image Tour",
          type: "TOUR",
          metadata: {
            featuredImage: media.secureUrl,
          },
        },
      });

      const res = await adminSession.delete(`${MEDIA_BASE}/${media.id}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain("Featured Image Tour");
      expect(cloudinary.uploader.destroy).not.toHaveBeenCalled();
    });

    it("blocks deletion if media is referenced in Tour metadata.images array", async () => {
      const media = await prisma.media.create({
        data: {
          assetId: "ref-img-1",
          publicId: "phukettours/tours/gallery_pic",
          secureUrl: "https://res.cloudinary.com/test-cloud/image/upload/gallery.jpg",
          format: "jpg",
          bytes: 1000,
          folder: "phukettours/tours",
          uploadedById: admin.id,
        },
      });

      await prisma.service.create({
        data: {
          name: "Gallery Tour",
          type: "TOUR",
          metadata: {
            images: [media.secureUrl, "https://res.cloudinary.com/other.jpg"],
          },
        },
      });

      const res = await adminSession.delete(`${MEDIA_BASE}/${media.id}`);

      expect(res.status).toBe(409);
      expect(res.body.message).toContain("Gallery Tour");
      expect(cloudinary.uploader.destroy).not.toHaveBeenCalled();
    });

    it("handles Cloudinary deletion failure safely without deleting DB record", async () => {
      const media = await prisma.media.create({
        data: {
          assetId: "del-err-1",
          publicId: "phukettours/tours/error_pic",
          secureUrl: "https://res.cloudinary.com/test-cloud/image/upload/err.jpg",
          format: "jpg",
          bytes: 1000,
          folder: "phukettours/tours",
          uploadedById: admin.id,
        },
      });

      vi.mocked(cloudinary.uploader.destroy).mockRejectedValue(
        new Error("Cloudinary connection refused"),
      );

      const res = await adminSession.delete(`${MEDIA_BASE}/${media.id}`);

      expect(res.status).toBe(502);
      expect(res.body.message).toContain("Failed to delete asset from Cloudinary");

      const stillExists = await prisma.media.findUnique({
        where: { id: media.id },
      });
      expect(stillExists).not.toBeNull();
    });

    it("deletes asset from Cloudinary and removes database record when unattached", async () => {
      const media = await prisma.media.create({
        data: {
          assetId: "del-success-1",
          publicId: "phukettours/tours/unreferenced_pic",
          secureUrl: "https://res.cloudinary.com/test-cloud/image/upload/unref.jpg",
          format: "jpg",
          bytes: 1000,
          folder: "phukettours/tours",
          uploadedById: admin.id,
        },
      });

      vi.mocked(cloudinary.uploader.destroy).mockResolvedValue({
        result: "ok",
      });

      const res = await adminSession.delete(`${MEDIA_BASE}/${media.id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain("Media deleted successfully");

      expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(
        "phukettours/tours/unreferenced_pic",
        {
          resource_type: "image",
          invalidate: true,
        },
      );

      const deletedRecord = await prisma.media.findUnique({
        where: { id: media.id },
      });
      expect(deletedRecord).toBeNull();
    });
  });
});
