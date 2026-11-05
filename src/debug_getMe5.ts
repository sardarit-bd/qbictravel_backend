import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import jwt from 'jsonwebtoken';
import env from './config/env.js';
import authMiddleware from './shared/middleware/authMiddleware.js';
import type { Request, Response, NextFunction } from 'express';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const request = await import('supertest').then(m => m.default);
  const realApp = await import('./app.js').then(m => m.default);
  
  const loginRes = await request(realApp)
    .post("/api/v1/auth/login")
    .send({ email: 'admin@phukettours.local', password: 'yzgTQLoJAUehktrWJaWqPQ' });
  
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
    await prisma.$disconnect();
    return;
  }
  
  // Direct authMiddleware test - with full logging
  const mockReq = {
    headers: { authorization: `Bearer ${token}` },
    cookies: {}
  } as any;
  mockReq.cookies.token = token;
  
  const mockRes = {
    statusCode: 200,
    setHeader: (name: string, value: string) => { console.log(`  res.setHeader(${name}, ${value})`); },
    json: (data: any) => { console.log(`  res.json: ${JSON.stringify(data)}`); return mockRes; },
    status: function(code: number) { this.statusCode = code; return this; },
    end: () => { console.log('  res.end()'); }
  } as any;
  
  console.log('=== Direct authMiddleware test ===');
  const nextCalled: string[] = [];
  const next = (err?: any) => {
    if (err) {
      console.log(`  next called with ERROR [${err.statusCode || 500}]: ${err.message}`);
      nextCalled.push(`error[${err.statusCode || 500}]: ${err.message}`);
    } else {
      console.log('  next called (success)');
      nextCalled.push('next');
    }
  };
  
  // Patch findAuthUserById to log
  const originalFindAuthUserById = await import('./modules/auth/authRepository.js').then(m => m.findAuthUserById);
  
  const mockFindAuthUserById = async (id: string) => {
    console.log(`  findAuthUserById(${id}) called`);
    const user = await originalFindAuthUserById(id);
    console.log(`  findAuthUserById result:`, user ? `id=${user.id}, role=${user.role}, status=${user.status}, tv=${user.tokenVersion}` : 'null');
    return user;
  };
  
  // Actually, let's just run the real authMiddleware and see what happens
  console.log('Running authMiddleware...');
  await authMiddleware(mockReq as Request, mockRes as Response, next);
  console.log('Next calls:', nextCalled);
  console.log('req.user after:', mockReq.user ? `role=${mockReq.user.role}` : 'NOT SET');
  
  await prisma.$disconnect();
}

main().catch(e => console.error('Fatal:', e.message));
