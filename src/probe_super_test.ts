import 'dotenv/config';
import request from 'supertest';
import app from './app.ts';

async function main() {
  console.log('=== Super isolated test: login + report ===');
  
  // Create a FRESH agent (no cookie jar carryover)
  const agent = request.agent(app);
  
  // Step 1: login
  console.log('Step 1: Login');
  const loginRes = await agent.post('/api/v1/auth/login').send({
    email: 'admin@phukettours.local',
    password: 'yzgTQLoJAUehktrWJaWqPQ'
  });
  console.log('Login status:', loginRes.status);
  
  // Step 2: Check /auth/me
  console.log('\nStep 2: /auth/me');
  const me = await agent.get('/api/v1/auth/me');
  console.log('/auth/me status:', me.status);
  console.log('/auth/me role:', me.body.data?.role);
  
  // Step 3: Hit the report endpoint
  console.log('\nStep 3: /admin/reports/bookings');
  const reps = await agent.get('/api/v1/admin/reports/bookings');
  console.log('reports/bookings status:', reps.status);
  console.log('reports/bookings message:', reps.body.message);
  
  console.log('\n=== Done ===');
}

main().catch(e => console.error('Fatal:', e.message));
