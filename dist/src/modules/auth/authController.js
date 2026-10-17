import env from "../../config/env.js";
import sendResponse from "../../shared/utils/response.js";
import { getOwnProfile } from "../user/userService.js";
import { registerUser, loginUser, logoutUser, forgotPassword as forgotPasswordService, resetPassword as resetPasswordService, } from "./authService.js";
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const cookieOptions = {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
};
export const register = async (req, res, next) => {
    try {
        const result = await registerUser(req.body);
        res.cookie("token", result.token, {
            ...cookieOptions,
            maxAge: COOKIE_MAX_AGE_MS,
        });
        sendResponse(res, 201, true, "User registered successfully", result.user);
    }
    catch (error) {
        next(error);
    }
};
export const login = async (req, res, next) => {
    try {
        const result = await loginUser(req.body);
        res.cookie("token", result.token, {
            ...cookieOptions,
            maxAge: COOKIE_MAX_AGE_MS,
        });
        sendResponse(res, 200, true, "Login successful", result.user);
    }
    catch (error) {
        next(error);
    }
};
export const logout = async (req, res, next) => {
    try {
        await logoutUser(req.auth);
        res.clearCookie("token", cookieOptions);
        sendResponse(res, 200, true, "Logged out successfully");
    }
    catch (error) {
        next(error);
    }
};
export const forgotPassword = async (req, res, next) => {
    try {
        await forgotPasswordService(req.body);
        sendResponse(res, 200, true, "If an account exists for this email, a password reset link has been sent");
    }
    catch (error) {
        next(error);
    }
};
export const resetPassword = async (req, res, next) => {
    try {
        await resetPasswordService(req.body);
        sendResponse(res, 200, true, "Password has been reset successfully");
    }
    catch (error) {
        next(error);
    }
};
export const me = async (req, res, next) => {
    try {
        const profile = await getOwnProfile(req.user.id);
        sendResponse(res, 200, true, "Profile retrieved successfully", profile);
    }
    catch (error) {
        next(error);
    }
};
