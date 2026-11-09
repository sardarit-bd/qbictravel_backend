import * as yup from "yup";

export const bookingIdParamSchema = yup.object({
  bookingId: yup.string().uuid("Invalid booking ID").required("Booking ID is required"),
});

export const updateAgentProfileSchema = yup.object({
  agencyName: yup.string().trim().max(100, "Agency name must be 100 characters or less").optional(),
  name: yup.string().trim().max(100, "Name must be 100 characters or less").optional(),
  phone: yup.string().trim().nullable().optional(),
});

export const createAgentCustomerSchema = yup.object({
  name: yup.string().trim().required("Customer name is required").max(100, "Name must be 100 characters or less"),
  email: yup.string().trim().email("Invalid email address").required("Customer email is required"),
  phone: yup.string().trim().max(30, "Phone must be 30 characters or less").nullable().optional(),
});
