import { describe, it, expect, vi, beforeEach } from "vitest";
import AppError from "../../../../shared/utils/AppError.js";

const mockAffiliateLink = {
  create: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
};

const mockService = {
  findFirst: vi.fn(),
};

const mockAffiliate = {
  findUnique: vi.fn(),
};

vi.mock("../../../../lib/prisma.js", () => {
  const mockPrisma = {
    affiliate: {
      findUnique: vi.fn(),
    },
    service: {
      findFirst: vi.fn(),
    },
    affiliateLink: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  return { prisma: mockPrisma };
});

vi.mock("../../affiliateNotification.js", () => ({
  affiliateNotification: {},
}));

vi.mock("../../affiliateCommissionService.js", () => ({
  getOrCreateAffiliateSettings: vi.fn(),
}));

import { affiliateService } from "../../affiliateService.js";
import { prisma } from "../../../../lib/prisma.js";

describe("affiliateService - Link Generation & Management Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(affiliateService, "requireApprovedAffiliate").mockResolvedValue({
      id: "aff-1",
      userId: "user-1",
      code: "AFF7777",
      status: "APPROVED",
    } as any);
  });

  it("generates a general website link with default 'PhuketTours Website' label when label is omitted", async () => {
    (prisma.affiliateLink.create as any).mockImplementation(({ data }: any) =>
      Promise.resolve({ id: "link-1", ...data })
    );

    const result = await affiliateService.createMyLink("user-1", {});

    expect(result.targetPath).toBe("/");
    expect(result.label).toBe("PhuketTours Website");
    expect(result.tourId).toBeNull();
    expect(prisma.affiliateLink.create).toHaveBeenCalledWith({
      data: {
        affiliateId: "aff-1",
        label: "PhuketTours Website",
        tourId: null,
        targetPath: "/",
      },
    });
  });

  it("persists custom campaign name for general link", async () => {
    (prisma.affiliateLink.create as any).mockImplementation(({ data }: any) =>
      Promise.resolve({ id: "link-1", ...data })
    );

    const result = await affiliateService.createMyLink("user-1", {
      label: "Facebook Spring Campaign",
    });

    expect(result.targetPath).toBe("/");
    expect(result.label).toBe("Facebook Spring Campaign");
  });

  it("generates tour link with published tour title fallback when label is omitted", async () => {
    vi.mocked(prisma.service.findFirst).mockResolvedValue({
      id: "tour-uuid-1",
      name: "Phi Phi Islands Sunrise Tour",
    } as any);
    (prisma.affiliateLink.create as any).mockImplementation(({ data }: any) =>
      Promise.resolve({ id: "link-2", ...data })
    );

    const result = await affiliateService.createMyLink("user-1", {
      tourId: "tour-uuid-1",
    });

    expect(result.targetPath).toBe("/tours/tour-uuid-1");
    expect(result.label).toBe("Phi Phi Islands Sunrise Tour");
    expect(result.tourId).toBe("tour-uuid-1");
  });

  it("rejects unpublished or non-existent tours with 404", async () => {
    vi.mocked(prisma.service.findFirst).mockResolvedValue(null);

    await expect(
      affiliateService.createMyLink("user-1", {
        tourId: "draft-or-missing-tour-uuid",
      })
    ).rejects.toThrow("Selected tour is not found or is not publicly published");
  });

  it("soft-archives an affiliate link without deleting records", async () => {
    vi.mocked(prisma.affiliateLink.findFirst).mockResolvedValue({
      id: "link-1",
      affiliateId: "aff-1",
      label: "My Link",
      isActive: true,
    } as any);
    vi.mocked(prisma.affiliateLink.update).mockResolvedValue({
      id: "link-1",
      affiliateId: "aff-1",
      label: "My Link",
      isActive: false,
    } as any);

    const result = await affiliateService.updateMyLink("user-1", "link-1", {
      isActive: false,
    });

    expect(result.isActive).toBe(false);
    expect(prisma.affiliateLink.update).toHaveBeenCalledWith({
      where: { id: "link-1" },
      data: {
        label: "My Link",
        isActive: false,
      },
    });
  });

  it("enforces affiliate ownership: cannot archive another affiliate's link", async () => {
    vi.mocked(prisma.affiliateLink.findFirst).mockResolvedValue(null);

    await expect(
      affiliateService.updateMyLink("user-1", "other-aff-link", {
        isActive: false,
      })
    ).rejects.toThrow("Affiliate link not found");
  });

  it("deactivates and preserves history when deleting link with click records", async () => {
    vi.mocked(prisma.affiliateLink.findFirst).mockResolvedValue({
      id: "link-with-clicks",
      affiliateId: "aff-1",
      label: "Campaign 2026",
      clickCount: 15,
      _count: { clicks: 15 },
    } as any);
    (prisma.affiliateLink.update as any).mockResolvedValue({
      id: "link-with-clicks",
      isActive: false,
      label: "[Deleted] Campaign 2026",
    });

    const result = await affiliateService.deleteMyLink("user-1", "link-with-clicks");

    expect((result as any).isActive).toBe(false);
    expect(prisma.affiliateLink.update).toHaveBeenCalledWith({
      where: { id: "link-with-clicks" },
      data: {
        isActive: false,
        label: "[Deleted] Campaign 2026",
      },
    });
  });

  it("safely deletes link with zero click records", async () => {
    vi.mocked(prisma.affiliateLink.findFirst).mockResolvedValue({
      id: "zero-click-link",
      affiliateId: "aff-1",
      label: "Unused Promo",
      clickCount: 0,
      _count: { clicks: 0 },
    } as any);
    vi.mocked(prisma.affiliateLink.delete).mockResolvedValue({
      id: "zero-click-link",
    } as any);

    const result = await affiliateService.deleteMyLink("user-1", "zero-click-link");

    expect((result as any).deleted).toBe(true);
    expect(prisma.affiliateLink.delete).toHaveBeenCalledWith({
      where: { id: "zero-click-link" },
    });
  });
});
