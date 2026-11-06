import * as yup from "yup";

export const bookingIdParamSchema = yup.object({
  bookingId: yup.string().uuid("Invalid booking ID").required("Booking ID is required"),
});

export const updateAgentProfileSchema = yup.object({
  agencyName: yup.string().trim().max(100, "Agency name must be 100 characters or less").optional(),
  name: yup.string().trim().max(100, "Name must be 100 characters or less").optional(),
  phone: yup.string().trim().nullable().optional(),
});
