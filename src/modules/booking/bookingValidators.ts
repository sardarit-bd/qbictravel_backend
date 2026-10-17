import * as yup from "yup";

export const createBookingSchema = yup.object({
  customerId: yup.string().uuid("Invalid customer ID").required("Customer ID is required"),
  agentId: yup.string().uuid("Invalid agent ID").optional(),
  serviceId: yup.string().uuid("Invalid service ID").required("Service ID is required"),
  availabilityId: yup.string().uuid("Invalid availability ID").optional(),
  proposedPrice: yup.number().min(0, "Proposed price must be at least 0").optional(),
});

export const updateBookingPriceSchema = yup.object({
  proposedPrice: yup.number().min(0, "Proposed price must be at least 0").required("Proposed price is required"),
});

export const reviewBookingPriceSchema = yup.object({
  status: yup.string().oneOf(["APPROVED", "REJECTED"]).required("Status is required"),
  approvedPrice: yup.number().min(0, "Approved price must be at least 0").when("status", {
    is: "APPROVED",
    then: (schema) => schema.required("Approved price is required for approval"),
    otherwise: (schema) => schema.optional(),
  }),
  notes: yup.string().trim().optional(),
});

export const bookingIdParamSchema = yup.object({
  bookingId: yup.string().uuid("Invalid booking ID").required("Booking ID is required"),
});