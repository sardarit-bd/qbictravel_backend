import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import request from 'supertest';
import app from './app.ts';
import bcrypt from 'bcrypt';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Get the admin user and their password hash
  const user = await prisma.user.findFirst({
    where: { email: 'admin@phukettours.local', deletedAt: null },
    select: { id: true, email: true, password: true, role: true, tokenVersion: true }
  });
  console.log('Admin user:', user ? `${user.id} role=${user.role} tokenVersion=${user.tokenVersion}` : 'not found');
  
  if (user) {
    // Try the known passwords
    const passwords = ['yzgTQLoJAUehktrWJaWqPQ', 'secret123', 'admin123', 'password'];
    for (const pw of passwords) {
      const valid = await bcrypt.compare(pw, user.password);
      console.log(`Password "${pw}": ${valid ? 'MATCHES' : 'no'}`);
    }
  }

  // Now try login with the matching password
  const agent = request.agent(app);
  const loginRes = await agent
    .post("/api/v1/auth/login")
    .send({ email: 'admin@phukettours.local', password: 'yzgTQLoJAUehktrWJaWqPQ' });

  console.log('Login with yzgTQLoJAUehktrWJaWqPQ:', loginRes.status);

  if (loginRes.status === 200) {
    const me = await agent.get('/api/v1/auth/me');
    console.log('/auth/me:', me.status, me.body.data?.role);

    const reports = await agent.get('/api/v1/admin/reports/bookings');
    console.log('reports/bookings:', reports.status, reports.body.message);
  }

  await prisma.$disconnect();
}

main().catch(e => console.error('Fatal:', e.message));
