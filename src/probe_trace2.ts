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

  const reps = await agent.get('/api/v1/admin/reports/bookings');
  console.log('reports/bookings status:', reps.status);
  console.log('reports/bookings body:', JSON.stringify(reps.body));
  
  // Check the me/permissions response for admin
  const perms = await agent.get('/api/v1/auth/me/permissions');
  console.log('auth/me/permissions status:', perms.status);
  console.log('auth/me/permissions body:', JSON.stringify(perms.body));
}

main().catch(e => console.error('Fatal:', e.message));
