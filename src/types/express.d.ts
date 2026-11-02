import type { AuthenticatedUser } from "./common.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      auth?: { jti: string; exp: number };
    }
  }
}

export {};