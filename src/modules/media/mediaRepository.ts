import { prisma } from "../../lib/prisma.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import type { PaginatedMediaResponse, MediaResponse } from "./mediaTypes.js";

export const findMediaById = async (id: string): Promise<MediaResponse | null> => {
  return prisma.media.findUnique({
    where: { id },
    include: {
      service: {
        select: {
          id: true,
          name: true,
          type: true,
        },
      },
    },
  });
};

export const findMediaByAssetId = async (
  assetId: string,
): Promise<MediaResponse | null> => {
  return prisma.media.findUnique({
    where: { assetId },
    include: {
      service: {
        select: {
          id: true,
          name: true,
          type: true,
        },
      },
    },
  });
};

export const findMediaByPublicId = async (
  publicId: string,
): Promise<MediaResponse | null> => {
  return prisma.media.findUnique({
    where: { publicId },
    include: {
      service: {
        select: {
          id: true,
          name: true,
          type: true,
        },
      },
    },
  });
};

export const createMediaRecord = async (
  data: Prisma.MediaUncheckedCreateInput,
): Promise<MediaResponse> => {
  return prisma.media.create({
    data,
    include: {
      service: {
        select: {
          id: true,
          name: true,
          type: true,
        },
      },
    },
  });
};

export const updateMediaRecord = async (
  id: string,
  data: Prisma.MediaUncheckedUpdateInput,
): Promise<MediaResponse> => {
  return prisma.media.update({
    where: { id },
    data,
    include: {
      service: {
        select: {
          id: true,
          name: true,
          type: true,
        },
      },
    },
  });
};

export const deleteMediaRecord = async (id: string): Promise<void> => {
  await prisma.media.delete({
    where: { id },
  });
};

export const listMedia = async (params: {
  page: number;
  limit: number;
  serviceId?: string;
  unattached?: boolean;
  search?: string;
}): Promise<PaginatedMediaResponse> => {
  const { page, limit, serviceId, unattached, search } = params;
  const skip = (page - 1) * limit;

  const where: Prisma.MediaWhereInput = {};

  if (serviceId) {
    where.serviceId = serviceId;
  } else if (unattached) {
    where.serviceId = null;
  }

  if (search) {
    where.OR = [
      { originalFilename: { contains: search, mode: "insensitive" } },
      { publicId: { contains: search, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.media.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        service: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
    }),
    prisma.media.count({ where }),
  ]);

  const totalPages = Math.ceil(total / limit) || 1;

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
};

export const findReferencingServices = async (
  secureUrl: string,
  publicId: string,
  serviceId?: string | null,
): Promise<Array<{ id: string; name: string }>> => {
  if (serviceId) {
    return prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT id, name FROM "Service"
      WHERE id = ${serviceId}
        OR (
          metadata IS NOT NULL
          AND (
            metadata::text LIKE ${"%" + secureUrl + "%"}
            OR metadata::text LIKE ${"%" + publicId + "%"}
          )
        )
      LIMIT 5;
    `;
  }

  return prisma.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT id, name FROM "Service"
    WHERE metadata IS NOT NULL
      AND (
        metadata::text LIKE ${"%" + secureUrl + "%"}
        OR metadata::text LIKE ${"%" + publicId + "%"}
      )
    LIMIT 5;
  `;
};

export const findServiceById = async (serviceId: string) => {
  return prisma.service.findUnique({
    where: { id: serviceId },
    select: { id: true, name: true },
  });
};

export const findMediaUploadAuthByPublicId = async (publicId: string) => {
  return prisma.mediaUploadAuth.findUnique({
    where: { publicId },
  });
};

export const createMediaUploadAuthRecord = async (
  data: Prisma.MediaUploadAuthUncheckedCreateInput,
) => {
  return prisma.mediaUploadAuth.create({
    data,
  });
};

export const consumeAuthAndCreateMedia = async (
  authId: string,
  mediaData: Prisma.MediaUncheckedCreateInput,
): Promise<MediaResponse> => {
  return prisma.$transaction(async (tx) => {
    await tx.mediaUploadAuth.update({
      where: { id: authId },
      data: { consumedAt: new Date() },
    });

    return tx.media.create({
      data: mediaData,
      include: {
        service: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
    });
  });
};
