import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import request from 'supertest';
import app from './app.ts';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const agent = request.agent(app);
  
  // Login
  const loginRes = await agent.post('/api/v1/auth/login').send({ 
    email: 'admin@phukettours.local', 
    password: 'yzgTQLoJAUehktrWJaWqPQ' 
  });
  console.log('Login:', loginRes.status);
  
  // Check /auth/me
  const me = await agent.get('/api/v1/auth/me');
  console.log('/auth/me body:', JSON.stringify(me.body.data));
  console.log('/auth/me role:', me.body.data?.role);
  console.log('/auth/me id:', me.body.data?.id);
  
  // Now add a debug route to the app temporarily
  // Actually, let's just check if the issue is that the app is using a different DB
  // Check the user count
  const count = await prisma.user.count();
  console.log('User count in DB:', count);
  
  // Check the admin user
  const admin = await prisma.user.findFirst({
    where: { email: 'admin@phukettours.local', deletedAt: null },
    select: { id: true, role: true, status: true, tokenVersion: true }
  });
  console.log('Admin in DB:', JSON.stringify(admin));
  
  // Check if there's a mismatch between the token user ID and the DB user ID
  console.log('Token user ID matches DB:', me.body.data?.id === admin?.id);
  
  await prisma.$disconnect();
}

main().catch(e => console.error('Fatal:', e.message));
