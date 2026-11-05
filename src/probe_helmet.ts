import 'dotenv/config';
import request from 'supertest';
import app from './app.ts';

async function main() {
  const agent = request.agent(app);
  const loginRes = await agent
    .post("/api/v1/auth/login")
    .send({ email: 'admin@phukettours.local', password: 'yzgTQLoJAUehktrWJaWqPQ' });
  console.log('Login:', loginRes.status);

  // Test the report endpoint
  const reps = await agent.get('/api/v1/admin/reports/bookings');
  console.log('reports/bookings:', reps.status);
  console.log('All headers:', reps.headers);
}

main().catch(e => console.error('Fatal:', e.message));
