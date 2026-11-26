import * as yup from "yup";

export const bookingIdParamSchema = yup.object({
  bookingId: yup.string().uuid("Invalid booking ID format").required(),
});

export const claimBookingByTokenSchema = yup.object({
  token: yup.string().required("Access token is required"),
});
