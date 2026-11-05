import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import request from 'supertest';
import app from './app.ts';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Check staffPermission assignments for the admin user  
  const sp = await prisma.staffPermission.findMany({
    where: { userId: '9f63fa69-ba04-4574-827e-d7030a73c5c8' },
    select: { permissionId: true }
  });
  console.log('staffPermission rows for admin:', sp.length, sp.map(s => s.permissionId));

  // Also check the permissions table
  const perms = await prisma.permission.findMany({
    where: { id: 'reports.view' },
    select: { id: true, name: true }
  });
  console.log('permission catalog reports.view:', JSON.stringify(perms));

  await prisma.$disconnect();
}

main().catch(e => console.error('Fatal:', e.message));
