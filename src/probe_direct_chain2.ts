import 'dotenv/config';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import env from './config/env.js';
import { findAuthUserById } from './modules/auth/authRepository.js';
import requirePermission from './shared/middleware/requirePermission.js';

async function main() {
  const request = await import('supertest').then(m => m.default);
  const app = await import('./app.js').then(m => m.default);
  
  const loginRes = await request(app)
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
  
  if (!token) return;
  
  // Replicate authMiddleware
  const decoded = jwt.verify(token, env.jwtSecret) as any;
  const user = await findAuthUserById(decoded.id);
  
  const req = {
    user: {
      id: user!.id,
      name: user!.name,
      email: user!.email,
      role: user!.role,
    }
  } as any;
  
  console.log('=== Testing imported requirePermission with REAL data ===');
  console.log('req.user:', JSON.stringify(req.user));
  console.log('req.user.role === "admin":', req.user.role === 'admin');
  
  // Test with the imported middleware  
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
  console.log('Result:', nextCalls[nextCalls.length - 1]);
  
  // Test with the EXACT same data but using a separate req object
  console.log('\n=== Test 2: Fresh req object ===');
  const req2 = {
    user: {
      id: '9f63fa69-ba04-4574-827e-d7030a73c5c8',
      name: 'Admin',
      email: 'admin@phukettours.local',
      role: 'admin'
    }
  } as any;
  
  console.log('req2.user.role:', req2.user.role);
  console.log('req2.user.role === "admin":', req2.user.role === 'admin');
  
  const next2Calls: string[] = [];
  const next2 = (err?: any) => {
    if (err) {
      next2Calls.push(`ERROR[${err.statusCode}]: ${err.message}`);
    } else {
      next2Calls.push('OK');
    }
  };
  
  await middleware(req2 as Request, {} as Response, next2);
  console.log('Result:', next2Calls[next2Calls.length - 1]);
}

main().catch(e => console.error('Fatal:', e.message));
