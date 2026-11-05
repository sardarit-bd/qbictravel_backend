import 'dotenv/config';
import request from 'supertest';
import app from './app.ts';

async function main() {
  const agent = request.agent(app);
  
  // Step 1: Login as the seeded admin  
  const loginRes = await agent
    .post("/api/v1/auth/login")
    .send({ email: 'admin@phukettours.local', password: 'yzgTQLoJAUehktrWJaWqPQ' });
  console.log('1. Login:', loginRes.status);
  
  // Step 2: Check /auth/me  
  const me = await agent.get('/api/v1/auth/me');
  console.log('2. /auth/me:', me.status, 'role:', me.body.data?.role);
  
  // Step 3: Check /auth/me/permissions
  const perms = await agent.get('/api/v1/auth/me/permissions');
  console.log('3. /auth/me/permissions:', perms.status);
  console.log('   isAdmin:', perms.body.data?.isAdmin);
  console.log('   role:', perms.body.data?.role);
  console.log('   has reports.view:', perms.body.data?.permissions?.includes('reports.view'));
  console.log('   has bookings.view:', perms.body.data?.permissions?.includes('bookings.view'));
  
  // Step 4: Test admin endpoints
  const media = await agent.get('/api/v1/admin/media?page=1&limit=1');
  console.log('4. /admin/media:', media.status);
  
  const users = await agent.get('/api/v1/admin/users?page=1&limit=1');
  console.log('5. /admin/users:', users.status);
  
  const services = await agent.get('/api/v1/admin/services?page=1&limit=1');
  console.log('6. /admin/services:', services.status);
  
  // Step 5: Test report endpoints
  const revenue = await agent.get('/api/v1/admin/reports/revenue');
  console.log('7. /admin/reports/revenue:', revenue.status, revenue.body.message);
  
  const bookings = await agent.get('/api/v1/admin/reports/bookings');
  console.log('8. /admin/reports/bookings:', bookings.status, bookings.body.message);
  
  const payments = await agent.get('/api/v1/admin/reports/payments');
  console.log('9. /admin/reports/payments:', payments.status, payments.body.message);
  
  const operations = await agent.get('/api/v1/admin/operations/bookings?page=1&limit=5');
  console.log('10. /admin/operations/bookings:', operations.status, operations.body.message);
}

main().catch(e => console.error('Fatal:', e.message));
