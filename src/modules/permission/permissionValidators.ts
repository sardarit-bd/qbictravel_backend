import * as yup from "yup";

export const staffIdParamSchema = yup.object({
  staffId: yup.string().uuid("Invalid staff ID format").required("Staff ID is required"),
});

export const updateStaffPermissionsSchema = yup.object({
  permissions: yup
    .array()
    .of(yup.string().required("Permission ID cannot be empty"))
    .max(50, "Too many permissions specified")
    .required("Permissions array is required"),
});

export type UpdateStaffPermissionsInput = {
  permissions: string[];
};
