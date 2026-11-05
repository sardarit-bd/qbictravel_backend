import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import env from './config/env.js';
import { findAuthUserById, isTokenRevoked } from './modules/auth/authRepository.js';
import AppError from './shared/utils/AppError.js';

const INVALID_TOKEN_MESSAGE = "Invalid or expired token";

const extractToken = (req: Request): string | null => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.split(" ")[1] || null;
  }
  const cookieToken = req.cookies?.token;
  return typeof cookieToken === "string" && cookieToken ? cookieToken : null;
};

const verifyToken = (token: string): any => {
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as any;
    if (typeof decoded.id !== "string" || typeof decoded.jti !== "string" || typeof decoded.exp !== "number" || typeof decoded.tv !== "number") {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
};

async function main() {
  // First, login to get the token
  const request = await import('supertest').then(m => m.default);
  const app = await import('./app.js').then(m => m.default);
  
  // We can't use agent with the dynamic import. Let's use a different approach.
  // Login via supertest directly
  const loginRes = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: 'admin@phukettours.local', password: 'yzgTQLoJAUehktrWJaWqPQ' })
    .set('Cookie', '');
  
  console.log('Login:', loginRes.status);
  
  // Extract token from set-cookie header
  const cookies = loginRes.headers['set-cookie'] || [];
  let token = null;
  for (const c of cookies) {
    if (typeof c === 'string' && c.startsWith('token=')) {
      token = c.split(';')[0].replace('token=', '');
      break;
    }
  }
  
  console.log('Token extracted:', token ? 'yes (' + token.substring(0, 20) + '...)' : 'no');
  
  if (!token) {
    await prisma.$disconnect();
    return;
  }
  
  // Get the user from DB
  const user = await findAuthUserById('9f63fa69-ba04-4574-827e-d7030a73c5c8');
  console.log('findAuthUserById result:', user ? `${user.id} role=${user.role} status=${user.status} tv=${user.tokenVersion}` : 'null');
  
  // Verify the token
  const payload = verifyToken(token);
  console.log('verifyToken result:', payload ? `id=${payload.id} tv=${payload.tv} jti=${payload.jti}` : 'null');
  
  // Check if token is revoked
  const revoked = await isTokenRevoked(payload?.jti);
  console.log('isTokenRevoked:', revoked);
  
  // Check token version match
  console.log('tokenVersion match:', payload?.tv === user?.tokenVersion);
  
  // Test authMiddleware with the extracted token
  const mockReq = {
    headers: { authorization: `Bearer ${token}` },
    cookies: {}
  } as any;
  mockReq.cookies.token = token;
  
  const mockRes = {
    statusCode: 200,
    setHeader: () => {},
    json: () => {},
    status: function(code: number) { this.statusCode = code; return this; },
    end: () => {}
  } as any;
  
  const nextCalls: string[] = [];
  const next = (err?: any) => {
    nextCalls.push(err ? `error[${err.statusCode}]: ${err.message}` : 'next');
  };
  
  console.log('\n=== Testing authMiddleware ===');
  await authMiddleware(mockReq, mockRes, next);
  console.log('authMiddleware calls:', nextCalls);
  console.log('req.user set:', mockReq.user ? `role=${mockReq.user.role}` : 'not set');
  
  await prisma.$disconnect();
}

// Need to import authMiddleware
import authMiddleware from './shared/middleware/authMiddleware.js';

main().catch(e => console.error('Fatal:', e.message));
