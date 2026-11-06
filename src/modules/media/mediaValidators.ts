import * as yup from "yup";
import { CLOUDINARY_FOLDER, MAX_BATCH_FILES } from "../../config/cloudinary.js";

export const createSignatureSchema = yup.object().shape({
  folder: yup
    .string()
    .optional()
    .test(
      "approved-folder",
      `Folder must be ${CLOUDINARY_FOLDER}`,
      (value) => !value || value === CLOUDINARY_FOLDER,
    ),
  publicId: yup
    .string()
    .optional()
    .test(
      "no-client-public-id",
      "Custom publicId is not permitted. Public IDs are strictly server-controlled.",
      (value) => value === undefined || value === null || value === "",
    ),
  batchSize: yup
    .number()
    .optional()
    .integer("batchSize must be an integer")
    .min(1, "batchSize must be at least 1")
    .max(MAX_BATCH_FILES, `batchSize cannot exceed ${MAX_BATCH_FILES}`),
});

export const confirmMediaSchema = yup.object().shape({
  publicId: yup
    .string()
    .required("publicId is required")
    .trim(),
  uploadToken: yup
    .string()
    .required("uploadToken is required")
    .trim(),
  assetId: yup
    .string()
    .optional()
    .trim(),
  serviceId: yup
    .string()
    .optional()
    .nullable()
    .uuid("serviceId must be a valid UUID"),
});

export const getMediaQuerySchema = yup.object().shape({
  page: yup
    .number()
    .optional()
    .default(1)
    .min(1, "page must be at least 1"),
  limit: yup
    .number()
    .optional()
    .default(20)
    .min(1, "limit must be at least 1")
    .max(100, "limit cannot exceed 100"),
  serviceId: yup
    .string()
    .optional()
    .uuid("serviceId must be a valid UUID"),
  unattached: yup
    .string()
    .optional()
    .oneOf(["true", "false"]),
  search: yup
    .string()
    .optional()
    .trim(),
});

export const mediaIdParamSchema = yup.object().shape({
  mediaId: yup
    .string()
    .required("mediaId is required")
    .uuid("mediaId must be a valid UUID"),
});
