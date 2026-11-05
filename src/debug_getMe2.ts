import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import type { Request, Response, NextFunction } from 'express';
import authMiddleware from './shared/middleware/authMiddleware.js';
import { getMyPermissions } from './modules/permission/permissionController.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

import { Router } from 'express';
const testRouter = Router();

// Replace the authMiddleware with a version that logs more
const loggedAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  console.log('[authMiddleware] Token present:', !!token);
  
  await authMiddleware(req, res, next);
  
  if (req.user) {
    console.log('[authMiddleware] User set: role=', req.user.role, 'id=', req.user.id);
  } else {
    console.log('[authMiddleware] User NOT set - next was called with error');
  }
};

testRouter.get(
  "/me/permissions",
  loggedAuthMiddleware,
  (req: Request, res: Response, next: NextFunction) => {
    console.log('[before getMyPermissions] req.user =', req.user ? `role=${req.user.role}` : 'NOT SET');
    getMyPermissions(req, res, next);
  },
  (req: Request, res: Response) => {
    console.log('[getMyPermissions done]');
  }
);

async function main() {
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
  
  console.log('\n=== Testing test router ===');
  const testReps = await request(testRouter)
    .get('/me/permissions')
    .set('Cookie', `token=${token}`);
  
  console.log('Status:', testReps.status);
  console.log('Body:', JSON.stringify(testReps.body));
  
  await prisma.$disconnect();
}

main().catch(e => console.error('Fatal:', e.message));
