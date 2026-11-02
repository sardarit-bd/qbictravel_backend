import type { UserRole, UserStatus } from "../../types/common.js";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  deletedAt?: Date | null;
  invitationStatus?: "none" | "pending" | "expired" | "completed";
  canResendInvitation?: boolean;
  createdAt: Date;
  updatedAt: Date;
  agentProfile: { agencyName: string | null } | null;
  businessOverview?: {
    totalBookings: number;
    pendingBookings: number;
    confirmedBookings: number;
    completedBookings: number;
    cancelledBookings: number;
    totalCommission: number;
    paidCommission: number;
    pendingCommission: number;
    activeCommissionsCount: number;
  };
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