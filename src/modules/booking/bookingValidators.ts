import * as yup from "yup";

export const createBookingSchema = yup.object({
  customerId: yup.string().uuid("Invalid customer ID").required("Customer ID is required"),
  agentId: yup.string().uuid("Invalid agent ID").optional(),
  serviceId: yup.string().uuid("Invalid service ID").required("Service ID is required"),
  availabilityId: yup.string().uuid("Invalid availability ID").optional(),
  packageId: yup.string().uuid("Invalid package ID").optional(),
  packageQuantity: yup.number().integer("Package quantity must be an integer").min(1, "At least 1 unit is required").max(20, "Maximum 20 units per booking").optional(),
  timeSlotId: yup.string().uuid("Invalid time slot ID").optional(),
  pickupZoneId: yup.string().uuid("Invalid pickup zone ID").optional(),
  departureTime: yup.string().trim().max(50).optional(),
  pickupLocation: yup.string().trim().max(500).optional(),
  isPrivateTransfer: yup.boolean().optional(),
  proposedPrice: yup.number().min(0, "Proposed price must be at least 0").optional(),
  travelDate: yup.string().trim().optional(),
  adults: yup.number().integer("Adults must be an integer").min(1, "At least 1 adult is required").max(50, "Maximum 50 adults per booking").optional(),
  children: yup.number().integer("Children must be an integer").min(0, "Children cannot be negative").max(50, "Maximum 50 children per booking").optional(),
  infants: yup.number().integer("Infants must be an integer").min(0, "Infants cannot be negative").max(50, "Maximum 50 infants per booking").optional(),
  notes: yup.string().trim().max(1000, "Notes must be at most 1000 characters").optional(),
  referralCode: yup.string().trim().max(50, "Referral code too long").optional(),
});

export const createStaffBookingSchema = yup
  .object({
    customerId: yup.string().uuid("Invalid customer ID").optional(),
    customer: yup
      .object({
        name: yup.string().trim().max(100, "Name must be 100 characters or less"),
        email: yup.string().trim().email("Invalid email address"),
        phone: yup
          .string()
          .trim()
          .max(30, "Phone must be 30 characters or less")
          .nullable()
          .optional(),
      })
      .notRequired()
      .default(undefined),
    serviceId: yup
      .string()
      .uuid("Invalid service ID")
      .required("Service ID is required"),
    availabilityId: yup.string().uuid("Invalid availability ID").optional(),
    packageId: yup.string().uuid("Invalid package ID").optional(),
    packageQuantity: yup.number().integer("Package quantity must be an integer").min(1, "At least 1 unit is required").max(20, "Maximum 20 units per booking").optional(),
    timeSlotId: yup.string().uuid("Invalid time slot ID").optional(),
    pickupZoneId: yup.string().uuid("Invalid pickup zone ID").optional(),
    departureTime: yup.string().trim().max(50).optional(),
    pickupLocation: yup.string().trim().max(500).optional(),
    travelDate: yup.string().trim().optional(),
    adults: yup
      .number()
      .integer("Adults must be an integer")
      .min(1, "At least 1 adult is required")
      .max(50, "Maximum 50 adults per booking")
      .optional(),
    children: yup
      .number()
      .integer("Children must be an integer")
      .min(0, "Children cannot be negative")
      .max(50, "Maximum 50 children per booking")
      .optional(),
    infants: yup
      .number()
      .integer("Infants must be an integer")
      .min(0, "Infants cannot be negative")
      .max(50, "Maximum 50 infants per booking")
      .optional(),
    notes: yup
      .string()
      .trim()
      .max(1000, "Notes must be at most 1000 characters")
      .optional(),
    discount: yup
      .object({
        discountType: yup
          .string()
          .oneOf(["PERCENTAGE", "FIXED_AMOUNT"], "discountType must be either PERCENTAGE or FIXED_AMOUNT")
          .required("discountType is required when discount is provided"),
        discountValue: yup
          .number()
          .typeError("discountValue must be a number")
          .positive("discountValue must be greater than zero")
          .required("discountValue is required when discount is provided")
          .test(
            "percentage-cap",
            "Percentage discount must not exceed 100%",
            function (value) {
              const { discountType } = this.parent;
              if (discountType === "PERCENTAGE" && value !== undefined && value > 100) {
                return false;
              }
              return true;
            }
          ),
        reason: yup
          .string()
          .trim()
          .min(1, "Reason is required and cannot be empty when discount is provided")
          .max(1000, "Reason cannot exceed 1000 characters")
          .required("Reason is required when discount is provided"),
      })
      .notRequired()
      .default(undefined),
  })
  .test(
    "customer-selection-or-inline",
    "Either customerId or customer details must be provided",
    (value) => {
      const hasId = Boolean(value?.customerId);
      const hasCustomer = Boolean(value?.customer && value?.customer?.email && value?.customer?.name);
      return (hasId && !hasCustomer) || (!hasId && hasCustomer);
    }
  );

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

export const reviewPendingBookingSchema = yup.object({
  action: yup.string().oneOf(["CONFIRM", "REJECT"]).required("Action is required"),
  notes: yup.string().trim().max(1000, "Notes must be at most 1000 characters").optional(),
  approvedDiscountValue: yup
    .number()
    .typeError("approvedDiscountValue must be a number")
    .positive("approvedDiscountValue must be greater than zero")
    .optional(),
  rejectionReason: yup
    .string()
    .trim()
    .max(1000, "Rejection reason cannot exceed 1000 characters")
    .optional(),
});

export const listPendingReservationsQuerySchema = yup.object({
  page: yup.number().integer().min(1).optional(),
  limit: yup.number().integer().min(1).max(100).optional(),
  search: yup.string().trim().optional(),
  paymentStatus: yup.string().oneOf(["UNPAID", "PARTIALLY_PAID", "PAID"]).optional(),
});

export const listStaffCustomersQuerySchema = yup.object({
  page: yup.number().integer().min(1).optional(),
  limit: yup.number().integer().min(1).max(100).optional(),
  search: yup.string().trim().optional(),
});

export const listStaffCreatedBookingsQuerySchema = yup.object({
  page: yup.number().integer().min(1).optional(),
  limit: yup.number().integer().min(1).max(100).optional(),
  scope: yup.string().oneOf(["my", "all"]).optional(),
  status: yup.string().trim().optional(),
  paymentStatus: yup.string().oneOf(["ALL", "UNPAID", "PARTIALLY_PAID", "PAID"]).optional(),
  fulfillmentStatus: yup.string().oneOf(["ALL", "NOT_STARTED", "IN_PROGRESS", "FULFILLED"]).optional(),
  search: yup.string().trim().optional(),
});

export const bookingIdParamSchema = yup.object({
  bookingId: yup.string().uuid("Invalid booking ID").required("Booking ID is required"),
});

export const createGuestBookingSchema = yup.object({
  customer: yup
    .object({
      name: yup
        .string()
        .trim()
        .min(2, "Name must be at least 2 characters")
        .max(100, "Name must be 100 characters or less")
        .required("Guest name is required"),
      email: yup
        .string()
        .trim()
        .email("Invalid email address")
        .required("Guest email is required"),
      phone: yup
        .string()
        .trim()
        .max(30, "Phone must be 30 characters or less")
        .nullable()
        .optional(),
    })
    .required("Guest contact details are required"),
  serviceId: yup
    .string()
    .uuid("Invalid service ID")
    .required("Service ID is required"),
  availabilityId: yup.string().uuid("Invalid availability ID").optional(),
  packageId: yup.string().uuid("Invalid package ID").optional(),
  packageQuantity: yup.number().integer("Package quantity must be an integer").min(1, "At least 1 unit is required").max(20, "Maximum 20 units per booking").optional(),
  timeSlotId: yup.string().uuid("Invalid time slot ID").optional(),
  pickupZoneId: yup.string().uuid("Invalid pickup zone ID").optional(),
  departureTime: yup.string().trim().max(50).optional(),
  pickupLocation: yup.string().trim().max(500).optional(),
  isPrivateTransfer: yup.boolean().optional(),
  travelDate: yup.string().trim().optional(),
  adults: yup
    .number()
    .integer("Adults must be an integer")
    .min(1, "At least 1 adult is required")
    .max(50, "Maximum 50 adults per booking")
    .optional(),
  children: yup
    .number()
    .integer("Children must be an integer")
    .min(0, "Children cannot be negative")
    .max(50, "Maximum 50 children per booking")
    .optional(),
  infants: yup
    .number()
    .integer("Infants must be an integer")
    .min(0, "Infants cannot be negative")
    .max(50, "Maximum 50 infants per booking")
    .optional(),
  notes: yup
    .string()
    .trim()
    .max(1000, "Notes must be at most 1000 characters")
    .optional(),
  referralCode: yup
    .string()
    .trim()
    .max(50, "Referral code too long")
    .optional(),
});

export const guestAccessTokenParamSchema = yup.object({
  token: yup
    .string()
    .required("Access token is required")
    .matches(/^[0-9a-fA-F]{64}$/, "Invalid token format"),
});

export const amendStaffBookingSchema = yup.object({
  customerName: yup.string().trim().max(100, "Name must be 100 characters or less").optional(),
  customerEmail: yup.string().trim().email("Invalid email address").optional(),
  customerPhone: yup.string().trim().max(30, "Phone must be 30 characters or less").nullable().optional(),
  travelDate: yup.string().trim().optional(),
  packageId: yup.string().uuid("Invalid package ID").optional(),
  packageQuantity: yup.number().integer("Package quantity must be an integer").min(1, "At least 1 unit is required").max(20, "Maximum 20 units per booking").optional(),
  timeSlotId: yup.string().uuid("Invalid time slot ID").optional(),
  pickupZoneId: yup.string().uuid("Invalid pickup zone ID").optional(),
  isPrivateTransfer: yup.boolean().optional(),
  adults: yup.number().integer("Adults must be an integer").min(1, "At least 1 adult is required").max(50).optional(),
  children: yup.number().integer("Children must be an integer").min(0).max(50).optional(),
  infants: yup.number().integer("Infants must be an integer").min(0).max(50).optional(),
  pickupLocation: yup.string().trim().max(500, "Pickup location must be at most 500 characters").optional(),
  departureTime: yup.string().trim().max(50).optional(),
  notes: yup.string().trim().max(1000, "Notes must be at most 1000 characters").optional(),
  discount: yup
    .object({
      discountType: yup.string().oneOf(["PERCENTAGE", "FIXED_AMOUNT"]).required("Discount type is required"),
      discountValue: yup
        .number()
        .typeError("Discount value must be a number")
        .positive("Discount value must be greater than zero")
        .required("Discount value is required"),
      reason: yup
        .string()
        .trim()
        .min(1, "Reason is required when discount is provided")
        .max(1000)
        .required("Reason is required when discount is provided"),
    })
    .notRequired()
    .default(undefined),
});

export const cancelStaffBookingSchema = yup.object({
  reason: yup.string().trim().max(1000, "Cancellation reason must be at most 1000 characters").optional(),
});

export const listAllActivityHistoryQuerySchema = yup.object({
  bookingId: yup.string().uuid("Invalid booking ID").optional(),
  actorId: yup.string().uuid("Invalid actor ID").optional(),
  action: yup.string().trim().optional(),
  startDate: yup.string().trim().optional(),
  endDate: yup.string().trim().optional(),
  search: yup.string().trim().optional(),
  page: yup.number().integer().min(1).optional(),
  limit: yup.number().integer().min(1).max(100).optional(),
});
