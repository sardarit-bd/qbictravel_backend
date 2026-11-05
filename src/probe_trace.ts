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
  console.log('reports/bookings headers:', Object.fromEntries(reps.headers.filter((_, k) => 
    ['x-powered-by', 'content-type', 'set-cookie'].includes(k)
  )));
  console.log('reports/bookings body:', JSON.stringify(reps.body));
  
  // Also check a known-working endpoint for comparison
  const media = await agent.get('/api/v1/admin/media?page=1&limit=1');
  console.log('media status:', media.status);
  console.log('media body:', JSON.stringify(media.body));
}

main().catch(e => console.error('Fatal:', e.message));
