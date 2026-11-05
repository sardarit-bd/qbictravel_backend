import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import type { Request, Response, NextFunction } from 'express';
import authMiddleware from './shared/middleware/authMiddleware.js';
import requirePermission from './shared/middleware/requirePermission.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Intercept the authMiddleware to log
const originalAuthMiddleware = authMiddleware;
const interceptedAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  console.log('[authMiddleware] Starting...');
  await originalAuthMiddleware(req, res, next);
  console.log(`[authMiddleware] Done. req.user.role = ${req.user?.role}`);
};

// Intercept requirePermission
const originalRequirePermission = requirePermission;
const interceptedRequirePermission = (permission: any) => {
  const middleware = originalRequirePermission(permission);
  return async (req: Request, res: Response, next: NextFunction) => {
    console.log(`[requirePermission] Starting. permission=${permission}, req.user.role=${req.user?.role}`);
    await middleware(req, res, next);
    console.log(`[requirePermission] Done. next called`);
  };
};

// Now create a test Express app with intercepted middleware
import { Router } from 'express';
const testRouter = Router();

testRouter.get(
  '/admin/reports/bookings',
  interceptedAuthMiddleware,
  interceptedRequirePermission('reports.view'),
  (req, res) => {
    console.log('[controller] Sending response');
    res.json({ success: true, data: 'test' });
  }
);

async function main() {
  // Get a real token from the full app
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
  
  console.log('Token:', token ? 'yes' : 'no');
  
  if (!token) {
    await prisma.$disconnect();
    return;
  }
  
  // Test the intercepted middleware chain
  console.log('\n=== Testing intercepted middleware ===');
  const testReps = await request(testRouter)
    .get('/admin/reports/bookings')
    .set('Cookie', `token=${token}`);
  
  console.log('Test result:', testReps.status);
  console.log('Test body:', testReps.body);
  
  await prisma.$disconnect();
}

main().catch(e => console.error('Fatal:', e.message));
