import { v2 as cloudinary } from "cloudinary";
import AppError from "../shared/utils/AppError.js";

export const CLOUDINARY_FOLDER = "phukettours/tours";
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_FORMATS = ["jpg", "jpeg", "png", "webp", "avif"] as const;
export type AllowedFormat = (typeof ALLOWED_FORMATS)[number];
export const MAX_BATCH_FILES = 10;
export const UPLOAD_RESOURCE_TYPE = "image" as const;

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

/**
 * Checks if all required Cloudinary environment variables are present and non-empty.
 */
export const isCloudinaryConfigured = (): boolean => {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
    process.env;
  return Boolean(
    CLOUDINARY_CLOUD_NAME?.trim() &&
      CLOUDINARY_API_KEY?.trim() &&
      CLOUDINARY_API_SECRET?.trim(),
  );
};

/**
 * Returns the Cloudinary credentials safely.
 * Throws a 503 AppError if configuration is missing, ensuring secrets are never leaked or undefined.
 */
export const getCloudinaryConfig = (): CloudinaryConfig => {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
    process.env;

  if (
    !CLOUDINARY_CLOUD_NAME?.trim() ||
    !CLOUDINARY_API_KEY?.trim() ||
    !CLOUDINARY_API_SECRET?.trim()
  ) {
    throw new AppError(
      "Cloudinary media service is not configured. Missing required environment variables.",
      503,
    );
  }

  return {
    cloudName: CLOUDINARY_CLOUD_NAME.trim(),
    apiKey: CLOUDINARY_API_KEY.trim(),
    apiSecret: CLOUDINARY_API_SECRET.trim(),
  };
};

/**
 * Ensures the Cloudinary SDK is initialized with valid credentials.
 */
export const getCloudinaryClient = () => {
  const config = getCloudinaryConfig();
  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
    secure: true,
  });
  return cloudinary;
};

export { cloudinary };
