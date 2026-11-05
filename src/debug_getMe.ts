import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import type { Request, Response, NextFunction } from 'express';
import authMiddleware from './shared/middleware/authMiddleware.js';
import { getMyPermissions } from './modules/permission/permissionController.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Create a test Express app with ONLY authMiddleware + getMyPermissions
import { Router } from 'express';
const testRouter = Router();

// Intercept authMiddleware to log req.user
const loggedAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  console.log('[authMiddleware] Before: req.user =', req.user ? `role=${req.user.role}` : 'not set');
  await authMiddleware(req, res, next);
  console.log('[authMiddleware] After: req.user =', req.user ? `role=${req.user.role}, id=${req.user.id}` : 'not set');
};

testRouter.get(
  "/me/permissions",
  loggedAuthMiddleware,
  getMyPermissions
);

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
  
  console.log('Token extracted:', token ? 'yes' : 'no');
  
  if (!token) {
    await prisma.$disconnect();
    return;
  }
  
  // Test the test router
  console.log('\n=== Testing test router ===');
  const testReps = await request(testRouter)
    .get('/me/permissions')
    .set('Cookie', `token=${token}`);
  
  console.log('Test router result:', testReps.status);
  console.log('Test body:', JSON.stringify(testReps.body));
  
  await prisma.$disconnect();
}

main().catch(e => console.error('Fatal:', e.message));
