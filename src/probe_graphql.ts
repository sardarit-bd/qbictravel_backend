import 'dotenv/config';
import request from 'supertest';
import app from './app.ts';

async function main() {
  const agent = request.agent(app);
  const loginRes = await agent
    .post("/api/v1/auth/login")
    .send({ email: 'admin@phukettours.local', password: 'yzgTQLoJAUehktrWJaWqPQ' });
  console.log('Login:', loginRes.status);
  
  // Check all headers from /auth/me/permissions
  const perms = await agent.get('/api/v1/auth/me/permissions');
  console.log('\n/auth/me/permissions headers:');
  for (const [key, value] of Object.entries(perms.headers)) {
    if (typeof value === 'string') {
      console.log(`  ${key}: ${value}`);
    }
  }
  
  // Check all headers from /admin/media (which works)
  const media = await agent.get('/api/v1/admin/media?page=1&limit=1');
  console.log('\n/admin/media headers:');
  for (const [key, value] of Object.entries(media.headers)) {
    if (typeof value === 'string') {
      console.log(`  ${key}: ${value}`);
    }
  }
  
  // Check all headers from /admin/reports/bookings (which fails)
  const reports = await agent.get('/api/v1/admin/reports/bookings');
  console.log('\n/admin/reports/bookings headers:');
  for (const [key, value] of Object.entries(reports.headers)) {
    if (typeof value === 'string') {
      console.log(`  ${key}: ${value}`);
    }
  }
}

main().catch(e => console.error('Fatal:', e.message));
