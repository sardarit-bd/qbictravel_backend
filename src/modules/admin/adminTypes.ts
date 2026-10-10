import type { UserRole, UserStatus } from "../../types/common.js";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
  agentProfile: { agencyName: string | null } | null;
}

export interface ListUsersQuery {
  page: number;
  limit: number;
  search?: string;
  role?: UserRole;
  status?: UserStatus;
}

export interface UpdateUserInput {
  name?: string;
  phone?: string | null;
  status?: UserStatus;
}

export interface UpdateAgentInput extends UpdateUserInput {
  agencyName?: string | null;
}

export interface CreateAgentInput {
  name: string;
  email: string;
  phone?: string;
  agencyName?: string;
}

export interface CreateStaffInput {
  name: string;
  email: string;
  phone?: string;
}

export interface CreateAccountInput {
  name: string;
  email: string;
  password: string;
  phone?: string;
  role: "agent" | "staff";
  agencyName?: string;
}