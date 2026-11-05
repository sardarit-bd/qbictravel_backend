import 'dotenv/config';
import request from 'supertest';
import app from './app.ts';

async function main() {
  // Login using the seeded admin credentials  
  const agent = request.agent(app);
  const loginRes = await agent
    .post("/api/v1/auth/login")
    .send({ email: 'admin@phukettours.local', password: 'yzgTQLoJAUehktrWJaWqPQ' });
  console.log('Login:', loginRes.status);
  
  if (loginRes.status !== 200) {
    console.log('Login failed:', loginRes.body);
    return;
  }

  // Extract the token from the cookie
  const cookie = agent.jar.getCookie('token');
  console.log('Token present:', !!cookie);
  if (cookie) {
    console.log('Token preview:', cookie.value?.substring(0, 30) + '...');
  }

  // Use the cookie-based auth
  const me = await agent.get('/api/v1/auth/me');
  console.log('/auth/me:', me.status, me.body.data?.role);

  // Now test the report endpoint
  const reports = await agent.get('/api/v1/admin/reports/bookings');
  console.log('reports/bookings:', reports.status);
}

main().catch(e => console.error('Fatal:', e.message));
