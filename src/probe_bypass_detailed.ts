import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import env from './config/env.js';
import authMiddleware from './shared/middleware/authMiddleware.js';
import requirePermission from './shared/middleware/requirePermission.js';
import { findAuthUserById } from './modules/auth/authRepository.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Get the admin's token from the login response
  const agent = request.agent(app);
  
  // We need supertest for the login, but let's use a different approach
  // Import supertest dynamically
  const request = await import('supertest').then(m => m.default);
  const loginRes = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: 'admin@phukettours.local', password: 'yzgTQLoJAUehktrWJaWqPQ' })
    .agent();
  
  // Actually, let's just get the token directly from the login
  console.log('Login status:', loginRes.status);
  
  // The cookie should be set. Let's extract it.
  const cookieHeader = loginRes.headers['set-cookie'];
  console.log('Set-Cookie headers:', cookieHeader?.length);
  
  let token = null;
  if (cookieHeader) {
    for (const c of cookieHeader) {
      if (c.startsWith('token=')) {
        token = c.split(';')[0].replace('token=', '');
        console.log('Extracted token:', token?.substring(0, 20) + '...');
      }
    }
  }
  
  if (!token) {
    console.log('No token found in cookie');
    await prisma.$disconnect();
    return;
  }

  // Now test authMiddleware directly
  const mockReq = {
    headers: { authorization: `Bearer ${token}` },
    cookies: { token }
  } as any;
  
  const mockRes = {
    statusCode: 200,
    setHeader: () => {},
    json: () => {},
    status: function(code) { this.statusCode = code; return this; },
    end: () => {}
  } as any;
  
  const calls: string[] = [];
  const next = (err?: any) => {
    calls.push(err ? `error: ${err.message}` : 'next');
  };
  
  console.log('=== Testing authMiddleware directly ===');
  await authMiddleware(mockReq as Request, mockRes as Response, next);
  console.log('authMiddleware result:', calls[calls.length - 1]);
  console.log('req.user after authMiddleware:', mockReq.user ? JSON.stringify({ id: mockReq.user.id, role: mockReq.user.role }) : 'no user set');
  
  calls.length = 0;
  
  console.log('=== Testing requirePermission (reports.view) ===');
  await requirePermission('reports.view')(mockReq as Request, mockRes as Response, next);
  console.log('requirePermission result:', calls[calls.length - 1]);
  console.log('req.user.role:', mockReq.user?.role);
  
  await prisma.$disconnect();
}

main().catch(e => console.error('Fatal:', e.message));
