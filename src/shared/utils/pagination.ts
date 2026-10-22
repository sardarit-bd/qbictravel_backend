import AppError from "./AppError.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const parsePagination = (query: Record<string, unknown>) => {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 20 : Number(query.limit);

  if (!Number.isInteger(page) || page < 1) {
    throw new AppError("Invalid page", 400);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError("Invalid limit (1 to 100)", 400);
  }

  return { page, limit, skip: (page - 1) * limit };
};

export const parseEnumQuery = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): T | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new AppError(`Invalid ${name}`, 400);
  }
  return value as T;
};

export const parseUuidQuery = (value: unknown, name: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new AppError(`Invalid ${name}`, 400);
  }
  return value;
};