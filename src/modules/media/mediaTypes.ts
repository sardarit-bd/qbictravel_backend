import type { PaginationMeta } from "../../types/common.js";

export interface CreateSignatureInput {
  folder?: string;
  batchSize?: number;
}

export interface UploadTokenPayload {
  adminId: string;
  publicId: string;
  folder: string;
  nonce: string;
  exp: number;
}

export interface UploadSignatureItem {
  signature: string;
  timestamp: number;
  publicId: string;
  uploadToken: string;
}

export interface UploadSignatureResponse {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
  folder: string;
  publicId: string;
  uploadUrl: string;
  maxFileSize: number;
  allowedFormats: readonly string[];
  uploadToken: string;
  batch?: UploadSignatureItem[];
}

export interface ConfirmMediaInput {
  publicId: string;
  uploadToken: string;
  assetId?: string;
  serviceId?: string | null;
}

export interface GetMediaQuery {
  page?: number;
  limit?: number;
  serviceId?: string;
  unattached?: boolean | string;
  search?: string;
}

export interface MediaResponse {
  id: string;
  assetId: string;
  publicId: string;
  secureUrl: string;
  originalFilename: string | null;
  format: string;
  resourceType: string;
  width: number | null;
  height: number | null;
  bytes: number;
  folder: string;
  uploadedById: string;
  serviceId: string | null;
  createdAt: Date;
  updatedAt: Date;
  service?: {
    id: string;
    name: string;
    type: string;
  } | null;
}

export interface PaginatedMediaResponse {
  items: MediaResponse[];
  pagination: PaginationMeta;
}
