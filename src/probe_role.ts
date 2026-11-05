import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import request from 'supertest';
import app from './app.ts';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: 'admin@phukettours.local', deletedAt: null },
    select: { id: true, role: true, status: true }
  });
  console.log('DB user:', JSON.stringify(user));

  const agent = request.agent(app);
  const loginRes = await agent.post('/api/v1/auth/login').send({ 
    email: 'admin@phukettours.local', 
    password: 'yzgTQLoJAUehktrWJaWqPQ' 
  });
  console.log('Login:', loginRes.status);

  const me = await agent.get('/api/v1/auth/me');
  console.log('/auth/me body:', JSON.stringify(me.body.data));

  await prisma.$disconnect();
}

main().catch(e => console.error('Fatal:', e.message));
