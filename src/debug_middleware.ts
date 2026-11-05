import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import authMiddleware from './shared/middleware/authMiddleware.js';
import requirePermission from './shared/middleware/requirePermission.js';

// Create a test router to debug the middleware chain
import { Router } from 'express';
const testRouter = Router();

// Copy the exact middleware chain from reportRoutes
testRouter.get(
  '/test-reports-bookings',
  authMiddleware,
  requirePermission('reports.view'),
  (req: Request, res: Response) => {
    console.log('Controller reached! req.user:', JSON.stringify(req.user));
    res.json({ success: true, data: 'ok' });
  }
);

async function main() {
  const agent = request.agent(app);
  const loginRes = await agent.post('/api/v1/auth/login').send({ 
    email: 'admin@phukettours.local', 
    password: 'yzgTQLoJAUehktrWJaWqPQ' 
  });
  console.log('Login:', loginRes.status);

  // Mount the test router and hit it
  // We can't easily mount it, so let's just test the middleware directly
  
  // Test authMiddleware directly
  const mockReq = { 
    headers: { authorization: `Bearer test` },
    cookies: { token: '' }
  } as any;
  
  console.log('Testing completed');
}

main().catch(e => console.error('Fatal:', e.message));
