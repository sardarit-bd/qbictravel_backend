import 'dotenv/config';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import env from './config/env.js';
import { findAuthUserById } from './modules/auth/authRepository.js';

async function main() {
  // Get a real token from the login
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
  
  if (!token) {
    console.log('No token');
    return;
  }
  
  console.log('=== Direct requirePermission test with REAL token ===');
  
  // Replicate EXACTLY what authMiddleware does
  const decoded = jwt.verify(token, env.jwtSecret) as any;
  console.log('Token decoded:', decoded.id, decoded.role, decoded.tv);
  
  const user = await findAuthUserById(decoded.id);
  console.log('User from DB:', user ? `${user.id} role=${user.role} status=${user.status} tv=${user.tokenVersion}` : 'null');
  
  // Build req.user exactly as authMiddleware does
  const req = {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    auth: { jti: decoded.jti, exp: decoded.exp }
  } as any;
  
  console.log('req.user built:', JSON.stringify(req.user));
  console.log('req.user.role:', req.user.role);
  console.log('typeof req.user.role:', typeof req.user.role);
  console.log('req.user.role === "admin":', req.user.role === 'admin');
  
  // Now run the EXACT requirePermission code
  const nextCalls: string[] = [];
  const next = (err?: any) => {
    if (err) {
      nextCalls.push(`next(error[${err.statusCode || 500}]): ${err.message}`);
    } else {
      nextCalls.push('next()');
    }
  };
  
  // Inline the requirePermission logic exactly as written
  console.log('\nRunning requirePermission inline...');
  
  if (!req.user) {
    next(new Error('Unauthorized'));
  } else if (req.user.role === "admin") {
    console.log('Admin bypass triggered');
    next();
  } else if (req.user.role !== "staff") {
    next(new Error('Forbidden: insufficient permissions'));
  } else {
    console.log('Staff check needed (not reached for admin)');
    next();
  }
  
  console.log('Next calls:', nextCalls);
  
  // Now test with the actual imported requirePermission
  console.log('\n=== Testing imported requirePermission ===');
  const { requirePermission } = await import('./shared/middleware/requirePermission.js');
  const middleware = requirePermission('reports.view');
  
  const next2Calls: string[] = [];
  const next2 = (err?: any) => {
    if (err) {
      next2Calls.push(`next(error[${err.statusCode || 500}]): ${err.message}`);
    } else {
      next2Calls.push('next()');
    }
  };
  
  await middleware(req as Request, {} as Response, next2);
  console.log('Imported requirePermission result:', next2Calls[next2Calls.length - 1]);
}

main().catch(e => console.error('Fatal:', e.message));
