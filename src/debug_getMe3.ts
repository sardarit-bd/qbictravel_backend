import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Get a real token
  const request = await import('supertest').then(m => m.default);
  const realApp = await import('./app.js').then(m => m.default);
  
  const loginRes = await request(realApp)
    .post("/api/v1/auth/login")
    .send({ email: 'admin@phukettours.local', password: 'yzgTQLoJAUehktrWJaWqPQ' });
  
  console.log('Login:', loginRes.status);
  
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
  
  console.log('Token:', token.substring(0, 30) + '...');
  
  // Decode the token to see what's in it
  import jwt from 'jsonwebtoken';
  import env from './config/env.js';
  
  try {
    const decoded = jwt.verify(token, env.jwtSecret);
    console.log('\nDecoded token:');
    console.log('  id:', decoded.id);
    console.log('  role:', decoded.role);
    console.log('  tv:', decoded.tv);
    console.log('  jti:', decoded.jti);
    console.log('  exp:', decoded.exp);
  } catch (e: any) {
    console.log('Token decode error:', e.message);
  }
  
  // Also verify via the authMiddleware directly
  import authMiddleware from './shared/middleware/authMiddleware.js';
  import type { Request, Response, NextFunction } from 'express';
  
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
  
  const nextCalled: string[] = [];
  const next = (err?: any) => {
    if (err) {
      nextCalled.push(`error[${err.statusCode || 500}]: ${err.message}`);
    } else {
      nextCalled.push('next');
    }
  };
  
  console.log('\n=== Direct authMiddleware test ===');
  await authMiddleware(mockReq, mockRes, next);
  console.log('Next calls:', nextCalled);
  console.log('req.user after authMiddleware:', mockReq.user ? `role=${mockReq.user.role}` : 'NOT SET');
  
  await prisma.$disconnect();
}

main().catch(e => console.error('Fatal:', e.message));
