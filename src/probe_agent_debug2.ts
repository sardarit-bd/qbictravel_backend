import 'dotenv/config';
import request from 'supertest';
import app from './app.ts';

async function main() {
  console.log('Starting...');
  
  // Login
  const loginRes = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: 'admin@phukettours.local', password: 'yzgTQLoJAUehktrWJaWqPQ' });
  
  console.log('Login:', loginRes.status);
  
  // Extract token
  const cookieHeader = loginRes.headers['set-cookie'];
  let token = '';
  if (cookieHeader) {
    for (const c of cookieHeader) {
      if (typeof c === 'string' && c.startsWith('token=')) {
        token = c.split(';')[0].replace('token=', '');
        break;
      }
    }
  }
  
  console.log('Token extracted:', token ? 'yes' : 'no');
  
  if (!token) return;
  
  // Test with cookie
  console.log('Testing with cookie...');
  const reps = await request(app)
    .get('/api/v1/admin/reports/bookings')
    .set('Cookie', `token=${token}`);
  
  console.log('reports/bookings (cookie):', reps.status);
  console.log('body:', reps.body);
  
  // Test with Authorization header
  console.log('Testing with Authorization header...');
  const reps2 = await request(app)
    .get('/api/v1/admin/reports/bookings')
    .set('Authorization', `Bearer ${token}`);
  
  console.log('reports/bookings (auth header):', reps2.status);
  console.log('body:', reps2.body);
}

main().catch(e => console.error('Fatal:', e.message));
