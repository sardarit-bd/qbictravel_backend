import type { JwtPayload } from "jsonwebtoken";
import type {
  AuthenticatedUser,
  UserRole,
  UserStatus,
} from "../../types/common.js";

export type AuthUser = AuthenticatedUser;

export interface AuthUserRecord extends AuthUser {
  status: UserStatus;
  tokenVersion: number;
}

export interface AuthUserWithPassword extends AuthUserRecord {
  password: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface ForgotPasswordInput {
  email: string;
}

export interface ResetPasswordInput {
  token: string;
  password: string;
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

export interface AuthResult {
  user: AuthUser;
  token: string;
}

export interface AuthSession {
  jti: string;
  exp: number;
}

export interface TokenPayload extends JwtPayload {
  id: string;
  role: UserRole;
  tv: number;
  jti: string;
  iat: number;
  exp: number;
}

export interface PasswordResetTokenRecord {
  id: string;
  userId: string;
  userStatus: UserStatus;
}

export interface SetupEmailTarget {
  id: string;
  name: string;
  email: string;
}