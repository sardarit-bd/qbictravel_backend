import AppError from "../utils/AppError.js";
import logger from "../logger/logger.js";
import sendResponse from "../utils/response.js";
const isProduction = process.env.NODE_ENV === "production";
/**
 * Checks if the given error object looks like a Prisma engine / database error.
 */
const isPrismaError = (err) => {
    if (!err || typeof err !== "object")
        return false;
    const name = err.name;
    if (typeof name === "string" && name.startsWith("PrismaClient")) {
        return true;
    }
    const message = err.message;
    if (typeof message === "string" &&
        (message.includes("prisma.") ||
            message.includes("PrismaClient") ||
            message.includes("The column ") ||
            message.includes("does not exist in the current database"))) {
        return true;
    }
    return false;
};
const errorHandler = (err, req, res, next) => {
    // 1. If it's a known operational application error
    if (err instanceof AppError) {
        // 4xx errors are safe to return to the caller
        if (err.statusCode < 500) {
            sendResponse(res, err.statusCode, false, err.message);
            return;
        }
    }
    // 2. For database/Prisma errors or internal server errors:
    // Always log full error and stack trace on the server side
    logger.error({
        err,
        path: req.originalUrl || req.url,
        method: req.method,
        stack: err.stack,
    }, `Unhandled error: ${err.message}`);
    // Return a generic safe message without leaking internal details or Prisma queries
    const safeMessage = !isProduction && !(err instanceof AppError) && !isPrismaError(err)
        ? err.message
        : "Internal Server Error";
    sendResponse(res, 500, false, safeMessage);
};
export default errorHandler;
