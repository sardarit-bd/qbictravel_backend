import 'dotenv/config';
import request from 'supertest';
import app from './app.ts';

async function main() {
  const agent = request.agent(app);
  const loginRes = await agent.post('/api/v1/auth/login').send({ 
    email: 'admin@phukettours.local', 
    password: 'yzgTQLoJAUehktrWJaWqPQ' 
  });

  console.log('Login status:', loginRes.status);
  if (loginRes.status !== 200) {
    console.log('Login body:', JSON.stringify(loginRes.body));
    return;
  }

  const me = await agent.get('/api/v1/auth/me');
  console.log('/auth/me:', me.status, 'role:', me.body.data?.role);

  const media = await agent.get('/api/v1/admin/media');
  console.log('/admin/media:', media.status);

  const reports = await agent.get('/api/v1/admin/reports/bookings');
  console.log('/admin/reports/bookings:', reports.status, reports.body.message);

  const ops = await agent.get('/api/v1/admin/operations/bookings');
  console.log('/admin/operations/bookings:', ops.status, ops.body.message);

  const revenue = await agent.get('/api/v1/admin/reports/revenue');
  console.log('/admin/reports/revenue:', revenue.status, revenue.body.message);
}

main().catch(e => console.error('Fatal:', e.message));
