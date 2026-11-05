import 'dotenv/config';
import request from 'supertest';
import app from './app.ts';

async function main() {
  const agent = request.agent(app);
  const loginRes = await agent
    .post("/api/v1/auth/login")
    .send({ email: 'admin@phukettours.local', password: 'yzgTQLoJAUehktrWJaWqPQ' });
  console.log('Login:', loginRes.status);

  // Test with all helmet-related headers explicitly set
  const reps = await agent
    .get('/api/v1/admin/reports/bookings')
    .set('Accept', 'application/json')
    .set('Accept-Language', 'en')
    .set('Content-Type', 'application/json');
  console.log('reports/bookings:', reps.status);
  console.log('body:', reps.body);

  // Also try without helmet by creating a fresh app without helmet
  // Actually, let's just test if helmet is the issue by checking the media endpoint
  // Media also uses helmet but returns 200
  const media = await agent.get('/api/v1/admin/media?page=1&limit=1');
  console.log('media:', media.status);
}

main().catch(e => console.error('Fatal:', e.message));
