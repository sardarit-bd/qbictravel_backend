import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import { checkStaffPermission } from './modules/permission/permissionRepository.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const adminId = '9f63fa69-ba04-4574-827e-d7030a73c5c8';
  
  console.log('Checking permissions for admin user:', adminId);
  console.log('=== checkStaffPermission results ===');
  
  const perms = ['reports.view', 'bookings.view', 'media.view', 'tours.view', 'users.view'];
  for (const perm of perms) {
    const result = await checkStaffPermission(adminId, perm);
    console.log(`  ${perm}: ${result}`);
  }
  
  await prisma.$disconnect();
}

main().catch(e => console.error('Fatal:', e.message));
