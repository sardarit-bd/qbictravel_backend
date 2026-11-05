import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import request from 'supertest';
import app from './app.ts';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Get a real admin user from the PROD db via the test db connection
  // Actually, let's use the DATABASE_URL which points to travel_test_isolated
  // But the admin@phukettours.local exists in both. Let's check which DB we're hitting.
  
  const userCount = await prisma.user.count();
  console.log('Total users in DB:', userCount);
  
  const admin = await prisma.user.findFirst({
    where: { email: 'admin@phukettours.local', deletedAt: null },
    select: { id: true, role: true, status: true, tokenVersion: true }
  });
  console.log('admin@phukettours.local:', JSON.stringify(admin));

  const agent = request.agent(app);
  const loginRes = await agent
    .post("/api/v1/auth/login")
    .send({ email: 'admin@phukettours.local', password: 'yzgTQLoJAUehktrWJaWqPQ' });
  console.log('Login:', loginRes.status);

  if (loginRes.status === 200) {
    const me = await agent.get('/api/v1/auth/me');
    console.log('/auth/me:', me.status, me.body.data?.role, me.body.data?.id);
    
    // Check if the user ID matches
    console.log('Auth me ID matches DB:', me.body.data?.id === admin?.id);

    const reports = await agent.get('/api/v1/admin/reports/bookings');
    console.log('reports/bookings:', reports.status);
  }

  await prisma.$disconnect();
}

main().catch(e => console.error('Fatal:', e.message));
