import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import logger from "../../shared/logger/logger.js";
import AppError from "../../shared/utils/AppError.js";
import { isUniqueConstraintError } from "../../shared/utils/prismaError.js";
import type {
  AuthenticatedUser,
  PaginatedResult,
} from "../../types/common.js";
import * as authRepository from "../auth/authRepository.js";
import { sendAccountSetupEmail } from "../auth/authService.js";
import * as adminRepository from "./adminRepository.js";
import { getAgentOverview } from "../agent/agentRepository.js";
import type {
  AdminUser,
  CreateAccountInput,
  CreateAgentInput,
  CreateStaffInput,
  ListUsersQuery,
  UpdateAgentInput,
  UpdateUserInput,
} from "./adminTypes.js";

const assertNotSelfStatusChange = (
  actor: AuthenticatedUser,
  targetId: string,
  input: UpdateUserInput,
): void => {
  if (input.status !== undefined && actor.id === targetId) {
    throw new AppError("You cannot change your own account status", 400);
  }
};

const createInvitedAccount = async (
  input: Omit<CreateAccountInput, "password">,
): Promise<AdminUser> => {
  const existing = await authRepository.findUserByEmail(input.email);

  if (existing) {
    throw new AppError("Email already registered", 409);
  }

  const password = await bcrypt.hash(randomBytes(32).toString("hex"), 10);

  let user: AdminUser;

  try {
    user = await adminRepository.createAccount({ ...input, password });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError("Email already registered", 409);
    }
    throw error;
  }

  try {
    await sendAccountSetupEmail(user);
  } catch (error) {
    logger.error({ err: error, userId: user.id }, "Failed to send account setup email");
  }

  return user;
};

export const listUsers = async (
  query: ListUsersQuery,
): Promise<PaginatedResult<AdminUser>> => {
  return adminRepository.listUsers(query);
};

export const getUser = async (userId: string): Promise<AdminUser> => {
  const user = await adminRepository.findUserById(userId);

  if (!user) {
    throw new AppError("User not found", 404);
  }

  return user;
};

export const updateUser = async (
  actor: AuthenticatedUser,
  userId: string,
  input: UpdateUserInput,
): Promise<AdminUser> => {
  await getUser(userId);
  assertNotSelfStatusChange(actor, userId, input);

  return adminRepository.updateUser(userId, input);
};

export const listAgents = async (
  query: ListUsersQuery,
): Promise<PaginatedResult<AdminUser>> => {
  return adminRepository.listUsers({ ...query, role: "agent" });
};

export const getAgent = async (agentId: string): Promise<AdminUser> => {
  const user = await adminRepository.findUserById(agentId);

  if (!user || user.role !== "agent") {
    throw new AppError("Agent not found", 404);
  }

  const businessOverview = await getAgentOverview(agentId);

  return {
    ...user,
    businessOverview,
  };
};

export const createAgent = async (
  input: CreateAgentInput,
): Promise<AdminUser> => {
  return createInvitedAccount({ ...input, role: "agent" });
};

export const updateAgent = async (
  actor: AuthenticatedUser,
  agentId: string,
  input: UpdateAgentInput,
): Promise<AdminUser> => {
  await getAgent(agentId);
  assertNotSelfStatusChange(actor, agentId, input);

  return adminRepository.updateUser(agentId, input);
};

export const listStaff = async (
  query: ListUsersQuery,
): Promise<PaginatedResult<AdminUser>> => {
  return adminRepository.listUsers({ ...query, role: "staff" });
};

export const createStaff = async (
  input: CreateStaffInput,
): Promise<AdminUser> => {
  return createInvitedAccount({ ...input, role: "staff" });
};

export const updateStaff = async (
  actor: AuthenticatedUser,
  staffId: string,
  input: UpdateUserInput,
): Promise<AdminUser> => {
  const user = await adminRepository.findUserById(staffId);

  if (!user || user.role !== "staff") {
    throw new AppError("Staff account not found", 404);
  }

  assertNotSelfStatusChange(actor, staffId, input);

  return adminRepository.updateUser(staffId, input);
};

export const deleteUser = async (
  actor: AuthenticatedUser,
  userId: string,
): Promise<AdminUser> => {
  const user = await getUser(userId);

  if (actor.id === userId) {
    throw new AppError("You cannot delete your own account", 400);
  }

  logger.info(
    { adminId: actor.id, deletedUserId: userId, role: user.role },
    "User soft-deleted successfully",
  );

  return adminRepository.deleteUser(userId);
};

export const resendInvitation = async (
  actor: AuthenticatedUser,
  userId: string,
): Promise<{ success: boolean; message: string }> => {
  const user = await getUser(userId);

  if (user.role !== "staff" && user.role !== "agent") {
    throw new AppError("Invitation can only be sent to staff or agent accounts", 400);
  }

  try {
    await sendAccountSetupEmail(user);
    logger.info(
      { adminId: actor.id, targetUserId: userId, role: user.role },
      "Resent invitation email successfully",
    );
    return { success: true, message: "Invitation email resent successfully" };
  } catch (error) {
    logger.error(
      { err: error, adminId: actor.id, targetUserId: userId },
      "Failed to resend invitation email",
    );
    throw new AppError("Failed to deliver invitation email. Please check SMTP settings.", 502);
  }
};