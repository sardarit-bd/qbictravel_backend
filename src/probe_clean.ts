import 'dotenv/config';
import request from 'supertest';
import app from './app.ts';

async function main() {
  // Login
  const agent = request.agent(app);
  const loginRes = await agent
    .post("/api/v1/auth/login")
    .send({ email: 'admin@phukettours.local', password: 'yzgTQLoJAUehktrWJaWqPQ' });
  console.log('Login:', loginRes.status);

  // Test the report endpoint directly (without /admin prefix routing)
  const cleanReports = await agent.get('/api/v1/admin/reports/bookings?from=2026-01-01&to=2026-12-31');
  console.log('reports/bookings:', cleanReports.status);
  
  // Test with a header-based auth instead of cookie
  const tokenRes = await agent.post('/api/v1/auth/login').send({ 
    email: 'admin@phukettours.local', 
    password: 'yzgTQLoJAUehktrWJaWqPQ' 
  });
  
  const reps2 = await agent.get('/api/v1/admin/reports/bookings');
  console.log('reports/bookings (attempt 2):', reps2.status);

  // Check the actual response headers
  console.log('response headers keys:', Object.keys(reps2.headers).join(', '));
  console.log('x-powered-by:', reps2.headers['x-powered-by']);
}

main().catch(e => console.error('Fatal:', e.message));
