import 'dotenv/config';
import request from 'supertest';
import app from './app.ts';

async function main() {
  const agent = request.agent(app);
  const loginRes = await agent.post('/api/v1/auth/login').send({ 
    email: 'admin@phukettours.local', 
    password: 'yzgTQLoJAUehktrWJaWqPQ' 
  });
  console.log('Login:', loginRes.status);

  // Test: does admin bypass work for a route mounted INSIDE the admin router?
  // The admin router at /api/v1/admin has router.use(authMiddleware) at line 25
  // But the admin router only defines routes under /api/v1/admin/* (users, staff, etc.)
  // The report routes at /api/v1/admin/reports/* are NOT defined in the admin router
  
  // Test a route that IS in the admin router
  const users = await agent.get('/api/v1/admin/users?page=1&limit=1');
  console.log('/admin/users (admin router):', users.status);

  // Test a route that is NOT in the admin router but is at /api/v1/admin/*
  // The report routes are at /api/v1 (not /api/v1/admin), so this shouldn't match
  // But let's check what happens with /api/v1/admin/reports/bookings
  // Express router matching: /api/v1/admin matches the admin router prefix
  // Then the admin router looks for /reports/bookings - not found
  // Express moves to the next app.use matching /api/v1
  
  // The key question: does Express call next() when a route is not found in a router?
  // In Express, when you use app.use('/api/v1/admin', router), and the router doesn't 
  // match the path, Express DOES call next() automatically.
  
  // So /api/v1/admin/reports/bookings should reach the report router at /api/v1
  // But the report router uses authMiddleware + requirePermission inline
  
  const reports = await agent.get('/api/v1/admin/reports/bookings');
  console.log('/admin/reports/bookings:', reports.status);
}

main().catch(e => console.error('Fatal:', e.message));
