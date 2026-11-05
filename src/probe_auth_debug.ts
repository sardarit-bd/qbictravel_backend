import 'dotenv/config';
import request from 'supertest';
import app from './app.ts';

async function main() {
  // Use the test password (which is what the seeded admin uses in test DB)  
  const agent = request.agent(app);
  const loginRes = await agent
    .post("/api/v1/auth/login")
    .send({ email: 'admin@phukettours.local', password: 'secret123' });

  console.log('Login with test password:', loginRes.status);
  if (loginRes.status !== 200) {
    console.log('Login body:', loginRes.body);
  }

  if (loginRes.status === 200) {
    const reports = await agent.get('/api/v1/admin/reports/bookings');
    console.log('reports/bookings:', reports.status, reports.body.message);

    const me = await agent.get('/api/v1/auth/me');
    console.log('/auth/me:', me.status, me.body.data?.role);
  }
}

main().catch(e => console.error('Fatal:', e.message));
