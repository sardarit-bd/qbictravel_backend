import 'dotenv/config';
import request from 'supertest';
import app from './app.ts';

async function main() {
  const agent = request.agent(app);
  const loginRes = await agent
    .post("/api/v1/auth/login")
    .send({ email: 'admin@phukettours.local', password: 'yzgTQLoJAUehktrWJaWqPQ' });
  console.log('Login:', loginRes.status);
  
  // Test various paths to understand the routing
  // /api/v1/admin/media -> mediaRoutes (mounted at /api/v1/admin/media) - WORKS (200)
  const media = await agent.get('/api/v1/admin/media?page=1&limit=1');
  console.log('/api/v1/admin/media:', media.status);
  
  // /api/v1/admin -> adminRoutes (mounted at /api/v1/admin) - handles /users, /staff, etc.
  // But the admin router doesn't have a /reports path
  // Express should call next() when no route matches
  
  // /api/v1/admin/reports/bookings -> should match reportRoutes at /api/v1
  // But FIRST Express checks /api/v1/admin (adminRoutes) - no match for /reports/*
  // THEN Express checks /api/v1 (reportRoutes) - matches /admin/reports/bookings
  
  // Let's verify the routing by checking what happens with different paths
  
  // Test a path that should ONLY be in reportRoutes (no /admin prefix)
  // Actually, reportRoutes doesn't have any non-/admin paths that we can test easily
  
  // Test: does Express call next() when adminRouter doesn't match?
  // We can check by adding a custom route that logs
  
  // For now, let's test if the 403 is consistent
  const reports1 = await agent.get('/api/v1/admin/reports/bookings');
  const reports2 = await agent.get('/api/v1/admin/reports/bookings');
  console.log('reports/bookings (1):', reports1.status);
  console.log('reports/bookings (2):', reports2.status);
  
  // Check if the issue is with the cookie or the token
  // Try with Authorization header instead
  const meRes = await agent.get('/api/v1/auth/me');
  const role = meRes.body.data?.role;
  console.log('Role from /auth/me:', role);
  
  // The role should be "admin"
  // If it's "admin", then the admin bypass in requirePermission should work
  
  // Let's also check the response when we send Authorization header directly
  const authHeader = `Bearer ${agent.jar.getCookie('token')?.value || ''}`;
  const reps3 = await agent.get('/api/v1/admin/reports/bookings');
  console.log('reports/bookings (3 - same agent):', reps3.status);
}

main().catch(e => console.error('Fatal:', e.message));
