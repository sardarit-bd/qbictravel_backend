export interface UpdateProfileInput {
  name?: string;
  phone?: string | null;
  avatarUrl?: string | null;
  avatarKey?: string | null;
}

export interface UpdateEmailInput {
  newEmail: string;
  currentPassword: string;
}

export interface ProfileAvatarSignatureResponse {
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
}

export interface ConfirmProfileAvatarInput {
  publicId: string;
  uploadToken: string;
  assetId?: string;
}