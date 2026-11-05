import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import jwt from 'jsonwebtoken';
import env from './config/env.js';
import { findAuthUserById } from './modules/auth/authRepository.js';
import requirePermission from './shared/middleware/requirePermission.js';
import type { Request, Response, NextFunction } from 'express';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Step 1: Get a token from the login response
  const request = await import('supertest').then(m => m.default);
  const app = await import('./app.js').then(m => m.default);
  
  console.log('Step 1: Login via supertest');
  const loginRes = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: 'admin@phukettours.local', password: 'yzgTQLoJAUehktrWJaWqPQ' });
  
  console.log('Login status:', loginRes.status);
  console.log('Content-Type:', loginRes.headers['content-type']);
  
  const cookieHeader = loginRes.headers['set-cookie'];
  console.log('Set-Cookie headers:', cookieHeader?.length);
  
  let token = '';
  if (cookieHeader) {
    for (const c of cookieHeader) {
      console.log(`  Cookie: ${(typeof c === 'string' ? c.substring(0, 40) + '...' : c)}`);
      if (typeof c === 'string' && c.startsWith('token=')) {
        token = c.split(';')[0].replace('token=', '');
        console.log(`  EXTRACTED TOKEN: ${token.substring(0, 30)}...`);
        break;
      }
    }
  }
  
  if (!token) {
    console.log('No token found!');
    await prisma.$disconnect();
    return;
  }
  
  // Step 2: Decode and verify the token
  console.log('\nStep 2: Decode token');
  const decoded = jwt.verify(token, env.jwtSecret) as any;
  console.log('Token decoded:', { id: decoded.id, role: decoded.role, tv: decoded.tv });
  
  // Step 3: Look up user in DB
  console.log('\nStep 3: findAuthUserById');
  const dbUser = await findAuthUserById(decoded.id);
  console.log('DB user:', dbUser ? { id: dbUser.id, role: dbUser.role, status: dbUser.status, tv: dbUser.tokenVersion } : null);
  
  // Step 4: Build req.user exactly as authMiddleware does
  console.log('\nStep 4: Build req.user');
  const req = {
    user: {
      id: dbUser!.id,
      name: dbUser!.name,
      email: dbUser!.email,
      role: dbUser!.role,
    }
  } as any;
  console.log('req.user:', JSON.stringify(req.user));
  console.log('req.user.role:', req.user.role);
  console.log('typeof req.user.role:', typeof req.user.role);
  console.log('req.user.role === "admin":', req.user.role === 'admin');
  console.log('req.user.role == "admin":', req.user.role == 'admin');
  
  // Step 5: Test requirePermission
  console.log('\nStep 5: Test requirePermission');
  const middleware = requirePermission('reports.view');
  const nextCalls: string[] = [];
  const next = (err?: any) => {
    if (err) {
      nextCalls.push(`ERROR[${err.statusCode}]: ${err.message}`);
    } else {
      nextCalls.push('OK');
    }
  };
  
  await middleware(req as Request, {} as Response, next);
  console.log('requirePermission result:', nextCalls[nextCalls.length - 1]);
  
  await prisma.$disconnect();
}

main().catch(e => console.error('Fatal:', e.message));
