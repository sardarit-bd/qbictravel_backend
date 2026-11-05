import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import jwt from 'jsonwebtoken';
import env from './config/env.js';
import { findAuthUserById } from './modules/auth/authRepository.js';
import requirePermission from './shared/middleware/requirePermission.js';
import type { Request, Response } from 'express';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const request = await import('supertest').then(m => m.default);
  const app = await import('./app.js').then(m => m.default);
  
  console.log('Step 1: Login via supertest');
  const loginRes = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: 'admin@phukettours.local', password: 'yzgTQLoJAUehktrWJaWqPQ' });
  
  console.log('Login status:', loginRes.status);
  
  const cookieHeader = loginRes.headers['set-cookie'];
  let token = '';
  if (cookieHeader) {
    for (const c of cookieHeader) {
      if (typeof c === 'string' && c.startsWith('token=')) {
        token = c.split(';')[0].replace('token=', '');
        break;
      }
    }
  }
  
  if (!token) {
    console.log('No token');
    await prisma.$disconnect();
    return;
  }
  
  console.log('Token extracted');
  
  // Decode and verify
  const decoded = jwt.verify(token, env.jwtSecret) as any;
  console.log('Token decoded:', { id: decoded.id, role: decoded.role });
  
  // Look up user
  const dbUser = await findAuthUserById(decoded.id);
  console.log('DB user:', dbUser ? `role=${dbUser.role}` : 'null');
  
  // Build req.user
  const req = {
    user: {
      id: dbUser!.id,
      name: dbUser!.name,
      email: dbUser!.email,
      role: dbUser!.role,
    }
  } as any;
  
  console.log('\nStep 2: Test requirePermission');
  console.log('req.user.role:', req.user.role);
  console.log('typeof req.user.role:', typeof req.user.role);
  
  const middleware = requirePermission('reports.view');
  const nextResult: string[] = [];
  const next = (err?: any) => {
    nextResult.push(err ? `ERROR` : `OK`);
  };
  
  await middleware(req as Request, {} as Response, next);
  console.log('requirePermission result:', nextResult[nextResult.length - 1]);
  
  await prisma.$disconnect();
}

main().catch(e => console.error('Fatal:', e.message));
