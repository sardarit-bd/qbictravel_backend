import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import jwt from 'jsonwebtoken';
import env from './config/env.js';
import authMiddleware from './shared/middleware/authMiddleware.js';
import requirePermission from './shared/middleware/requirePermission.js';
import type { Request, Response, NextFunction } from 'express';
import AppError from './shared/utils/AppError.js';

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
  
  console.log('=== Full middleware chain test (with debug) ===');
  
  // Step 1: authMiddleware  
  console.log('Step 1: authMiddleware');
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
  
  const next1 = () => { console.log('  authMiddleware -> next()'); };
  await authMiddleware(mockReq as Request, mockRes as Response, next1);
  console.log('  req.user:', mockReq.user ? `role=${mockReq.user.role}` : 'NOT SET');
  
  // Step 2: requirePermission (full implementation from source)
  console.log('\nStep 2: requirePermission("reports.view")');
  console.log('  req.user.role:', mockReq.user?.role);
  console.log('  req.user.role === "admin":', mockReq.user?.role === 'admin');
  
  // Inline the requirePermission logic to debug
  if (!mockReq.user) {
    console.log('  ERROR: req.user is not set!');
  } else if (mockReq.user.role === 'admin') {
    console.log('  Admin bypass triggered - should call next()');
  } else if (mockReq.user.role !== 'staff') {
    console.log(`  ERROR: role is "${mockReq.user.role}" (not admin, not staff) -> 403`);
  } else {
    console.log('  Staff permission check needed');
  }
  
  // Now run the actual requirePermission
  const next2Calls: string[] = [];
  const next2 = (err?: any) => {
    if (err) {
      next2Calls.push(`next(error[${err.statusCode || 500}]): ${err.message}`);
    } else {
      next2Calls.push('next()');
    }
  };
  
  await requirePermission('reports.view')(mockReq as Request, mockRes as Response, next2);
  console.log('  requirePermission result:', next2Calls[next2Calls.length - 1]);
  
  await prisma.$disconnect();
}

main().catch(e => console.error('Fatal:', e.message));
