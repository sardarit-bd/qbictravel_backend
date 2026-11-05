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

  // Verify the token is set in the cookie
  console.log('Cookies after login:', agent.jar.getCookie('token')?.value?.substring(0, 20) + '...');

  // Now test with the cookie explicitly
  const reports = await agent.get('/api/v1/admin/reports/bookings');
  console.log('reports/bookings:', reports.status, reports.body.message);

  // Let's also check if the cookie-based auth works for the admin
  // by testing a route that we KNOW works
  const media = await agent.get('/api/v1/admin/media?page=1&limit=1');
  console.log('media:', media.status);
}

main().catch(e => console.error('Fatal:', e.message));
