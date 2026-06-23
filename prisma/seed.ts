import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TENANT_ID = 'tenant-001';

async function main() {
  await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: {},
    create: {
      id: TENANT_ID,
      name: 'Acme Corp',
    },
  });

  await prisma.employee.upsert({
    where: { id: 'employee-001' },
    update: {},
    create: {
      id: 'employee-001',
      tenantId: TENANT_ID,
      name: 'Aisha Bello',
      annualLeaveBalance: 10,
    },
  });

  await prisma.employee.upsert({
    where: { id: 'employee-002' },
    update: {},
    create: {
      id: 'employee-002',
      tenantId: TENANT_ID,
      name: 'Tunde Okafor',
      annualLeaveBalance: 18,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
