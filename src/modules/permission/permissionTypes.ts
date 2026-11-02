import type { PermissionDefinition } from "./permissionConstants.js";

export interface PermissionCatalogResponse {
  modules: {
    module: string;
    permissions: PermissionDefinition[];
  }[];
  totalPermissions: number;
}

export interface StaffPermissionsResponse {
  staffId: string;
  staffName: string;
  staffEmail: string;
  permissions: string[];
}

export interface UpdateStaffPermissionsBody {
  permissions: string[];
}

export interface EffectivePermissionsResponse {
  userId: string;
  role: string;
  isAdmin: boolean;
  permissions: string[];
}
