import 'dotenv/config';
import request from 'supertest';
import app from './app.ts';

async function main() {
  // Use supertest directly (not agent)
  const res1 = await request(app)
    .post("/api/v1/auth/login")
    .send({ email: 'admin@phukettours.local', password: 'yzgTQLoJAUehktrWJaWqPQ' })
    .cookie();
  
  console.log('Login:', res1.status);
  console.log('Set-Cookie:', res1.headers['set-cookie']?.map(c => c?.split(';')[0]).join(', '));
  
  // Extract the token
  const cookieHeader = res1.headers['set-cookie'];
  let token = '';
  if (cookieHeader) {
    for (const c of cookieHeader) {
      if (typeof c === 'string' && c.startsWith('token=')) {
        token = c.split(';')[0].replace('token=', '');
        break;
      }
    }
  }
  
  console.log('Token:', token ? token.substring(0, 20) + '...' : 'none');
  
  // Now make a request with the token as a cookie
  const reps = await request(app)
    .get('/api/v1/admin/reports/bookings')
    .set('Cookie', `token=${token}`);
  
  console.log('reports/bookings (cookie):', reps.status);
  
  // Also try with Authorization header
  const reps2 = await request(app)
    .get('/api/v1/admin/reports/bookings')
    .set('Authorization', `Bearer ${token}`);
  
  console.log('reports/bookings (auth header):', reps2.status);
  
  // Try with both
  const reps3 = await request(app)
    .get('/api/v1/admin/reports/bookings')
    .set('Cookie', `token=${token}`)
    .set('Authorization', `Bearer ${token}`);
  
  console.log('reports/bookings (both):', reps3.status);
}

main().catch(e => console.error('Fatal:', e.message));
