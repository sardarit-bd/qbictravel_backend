import * as yup from "yup";

export const createBookingSchema = yup.object({
  customerId: yup.string().uuid("Invalid customer ID").required("Customer ID is required"),
  agentId: yup.string().uuid("Invalid agent ID").optional(),
  serviceId: yup.string().uuid("Invalid service ID").required("Service ID is required"),
  availabilityId: yup.string().uuid("Invalid availability ID").optional(),
  proposedPrice: yup.number().min(0, "Proposed price must be at least 0").optional(),
  travelDate: yup.string().trim().optional(),
  adults: yup.number().integer("Adults must be an integer").min(1, "At least 1 adult is required").max(50, "Maximum 50 adults per booking").optional(),
  children: yup.number().integer("Children must be an integer").min(0, "Children cannot be negative").max(50, "Maximum 50 children per booking").optional(),
  infants: yup.number().integer("Infants must be an integer").min(0, "Infants cannot be negative").max(50, "Maximum 50 infants per booking").optional(),
  notes: yup.string().trim().max(1000, "Notes must be at most 1000 characters").optional(),
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