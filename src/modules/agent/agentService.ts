import AppError from "../../shared/utils/AppError.js";
import * as agentRepository from "./agentRepository.js";
import type {
  ListAgentBookingsParams,
  ListAgentCustomersParams,
  CreateAgentCustomerInput,
  UpdateAgentProfileInput,
} from "./agentRepository.js";

export const getAgentOverview = async (agentId: string) => {
  return agentRepository.getAgentOverview(agentId);
};

export const listAgentBookings = async (
  agentId: string,
  params: ListAgentBookingsParams
) => {
  return agentRepository.listAgentBookings(agentId, params);
};

export const getAgentBooking = async (agentId: string, bookingId: string) => {
  const booking = await agentRepository.findAgentBookingById(agentId, bookingId);
  if (!booking) {
    throw new AppError("Booking not found", 404);
  }
  return booking;
};

export const listAgentCustomers = async (
  agentId: string,
  params: ListAgentCustomersParams
) => {
  return agentRepository.listAgentCustomers(agentId, params);
};

export const createAgentCustomer = async (
  agentId: string,
  data: CreateAgentCustomerInput
) => {
  return agentRepository.createOrResolveAgentCustomer(agentId, data);
};

export const getAgentProfile = async (agentId: string) => {
  const profile = await agentRepository.findAgentProfile(agentId);
  if (!profile) {
    throw new AppError("Agent profile not found", 404);
  }
  return profile;
};

export const updateAgentProfile = async (
  agentId: string,
  data: UpdateAgentProfileInput
) => {
  const existing = await agentRepository.findAgentProfile(agentId);
  if (!existing) {
    throw new AppError("Agent profile not found", 404);
  }

  return agentRepository.updateAgentProfile(agentId, data);
};
