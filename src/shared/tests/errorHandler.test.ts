import { describe, it, expect, vi } from "vitest";
import errorHandler from "../errors/errorHandler.js";
import AppError from "../utils/AppError.js";
import type { Request, Response } from "express";

vi.mock("../logger/logger.js", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("Backend Error Handler", () => {
  const createMockReqRes = () => {
    const req = {
      originalUrl: "/auth/login",
      method: "POST",
    } as unknown as Request;

    let statusCode = 200;
    let jsonData: unknown = null;

    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: unknown) {
        jsonData = data;
        return this;
      },
    } as unknown as Response;

    const next = vi.fn();

    return {
      req,
      res,
      next,
      getStatus: () => statusCode,
      getJson: () => jsonData,
    };
  };

  it("returns operational 4xx AppError message directly", () => {
    const { req, res, next, getStatus, getJson } = createMockReqRes();
    const error = new AppError("Invalid email or password", 401);

    errorHandler(error, req, res, next);

    expect(getStatus()).toBe(401);
    expect(getJson()).toEqual({
      success: false,
      message: "Invalid email or password",
      data: null,
    });
  });

  it("returns operational 502 Bad Gateway and 503 Service Unavailable AppError messages directly", () => {
    const { req, res, next, getStatus, getJson } = createMockReqRes();
    const error503 = new AppError("Cloudinary media service is not configured", 503);

    errorHandler(error503, req, res, next);

    expect(getStatus()).toBe(503);
    expect(getJson()).toEqual({
      success: false,
      message: "Cloudinary media service is not configured",
      data: null,
    });

    const error502 = new AppError("Failed to delete asset from Cloudinary", 502);
    errorHandler(error502, req, res, next);

    expect(getStatus()).toBe(502);
    expect(getJson()).toEqual({
      success: false,
      message: "Failed to delete asset from Cloudinary",
      data: null,
    });
  });

  it("masks Prisma error message and returns 500 Internal Server Error", () => {
    const { req, res, next, getStatus, getJson } = createMockReqRes();
    const prismaError = new Error(
      "Invalid prisma.user.findFirst() invocation: The column User.deletedAt does not exist in the current database.",
    );
    prismaError.name = "PrismaClientKnownRequestError";

    errorHandler(prismaError, req, res, next);

    expect(getStatus()).toBe(500);
    expect(getJson()).toEqual({
      success: false,
      message: "Internal Server Error",
      data: null,
    });
  });

  it("masks internal 500 AppError messages as Internal Server Error", () => {
    const { req, res, next, getStatus, getJson } = createMockReqRes();
    const error = new AppError("Database connection lost", 500);

    errorHandler(error, req, res, next);

    expect(getStatus()).toBe(500);
    expect(getJson()).toEqual({
      success: false,
      message: "Internal Server Error",
      data: null,
    });
  });
});
