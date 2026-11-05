import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import env from './config/env.js';
import request from 'supertest';

// Create a MINIMAL app that only has the authMiddleware + requirePermission chain
const miniApp = express();
miniApp.use(cookieParser());

// Mock user database lookup
const mockFindAuthUserById = async (id: string) => {
  if (id === 'admin-id') {
    return { id: 'admin-id', role: 'admin', status: 'active', tokenVersion: 0 };
  }
  return null;
};

const mockIsTokenRevoked = async () => false;

// Replicate authMiddleware logic
miniApp.use(async (req, _res, next) => {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return next(new Error('Unauthorized'));
  }
  
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as any;
    if (!decoded || typeof decoded.id !== 'string') {
      return next(new Error('Invalid token'));
    }
    
    const user = await mockFindAuthUserById(decoded.id);
    if (!user || user.tokenVersion !== decoded.tv) {
      return next(new Error('Invalid token version'));
    }
    
    req.user = { id: user.id, role: user.role };
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

// Replicate requirePermission logic
miniApp.get('/test-reports', async (req, _res, next) => {
  if (!req.user) return next(new Error('Unauthorized'));
  
  // Admin bypass
  if (req.user.role === 'admin') {
    console.log('Admin bypass triggered!');
    return next();
  }
  
  // Staff check would go here...
  return next(new Error('Forbidden: insufficient permissions'));
}, (req, res) => {
  res.json({ success: true, data: 'reports data', userRole: req.user?.role });
});

// Generate a test token for admin
const adminToken = jwt.sign(
  { id: 'admin-id', jti: 'test-jti', exp: Math.floor(Date.now() / 1000) + 3600, tv: 0 },
  env.jwtSecret
);

console.log('Test token generated:', adminToken.substring(0, 20) + '...');
console.log('Admin role in token:', 'admin');

async function main() {
  // Test with the minimal app
  const reps = await request(miniApp)
    .get('/test-reports')
    .set('Cookie', `token=${adminToken}`);
  
  console.log('\nMinimal app result:');
  console.log('Status:', reps.status);
  console.log('Body:', reps.body);
  
  // Now test the REAL app
  console.log('\n=== Real app test ===');
  const realApp = await import('./app.js').then(m => m.default);
  
  const loginRes = await request(realApp)
    .post("/api/v1/auth/login")
    .send({ email: 'admin@phukettours.local', password: 'yzgTQLoJAUehktrWJaWqPQ' });
  
  console.log('Real app login:', loginRes.status);
  
  const cookieHeader = loginRes.headers['set-cookie'];
  let realToken = '';
  if (cookieHeader) {
    for (const c of cookieHeader) {
      if (typeof c === 'string' && c.startsWith('token=')) {
        realToken = c.split(';')[0].replace('token=', '');
        break;
      }
    }
  }
  
  console.log('Real token:', realToken ? 'yes' : 'no');
  
  if (realToken) {
    const realReps = await request(realApp)
      .get('/api/v1/admin/reports/bookings')
      .set('Cookie', `token=${realToken}`);
    
    console.log('Real app reports/bookings:', realReps.status);
    console.log('Real app body:', realReps.body);
  }
}

main().catch(e => console.error('Fatal:', e.message));
