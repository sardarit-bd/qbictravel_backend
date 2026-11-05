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

  // Test the report route WITHOUT the /admin prefix (direct path)
  const reportsDirect = await agent.get('/api/v1/admin/reports/bookings?from=2026-01-01&to=2026-12-31');
  console.log('/api/v1/admin/reports/bookings (full):', reportsDirect.status, reportsDirect.body.message);

  // Also test a route that's ONLY in the report router (no /admin prefix conflict)
  // The report router is at /api/v1, so /api/v1/admin/reports/bookings would match
  // But let's test with a fresh app to see if there's something in adminRoutes intercepting
  
  // Test the operations route
  const ops = await agent.get('/api/v1/admin/operations/bookings?page=1&limit=5');
  console.log('/admin/operations/bookings:', ops.status, ops.body.message);
}

main().catch(e => console.error('Fatal:', e.message));
