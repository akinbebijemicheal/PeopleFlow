import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const TEST_TENANT_ID = 'tenant-001';
export const EMPLOYEE_001 = 'employee-001';
export const EMPLOYEE_002 = 'employee-002';
export const EMPLOYEE_001_STARTING_BALANCE = 10;
export const EMPLOYEE_002_STARTING_BALANCE = 18;

/**
 * Tests run against the same database as DATABASE_URL (no separate test DB
 * for this assessment's scope). This resets leave_requests and both seeded
 * employees' balances before every test so runs are deterministic regardless
 * of execution order or what a previous run left behind.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.leaveRequest.deleteMany({ where: { tenantId: TEST_TENANT_ID } });
  await prisma.employee.update({
    where: { id: EMPLOYEE_001 },
    data: { annualLeaveBalance: EMPLOYEE_001_STARTING_BALANCE },
  });
  await prisma.employee.update({
    where: { id: EMPLOYEE_002 },
    data: { annualLeaveBalance: EMPLOYEE_002_STARTING_BALANCE },
  });
}

export async function disconnectTestDb(): Promise<void> {
  await prisma.$disconnect();
}

export { prisma as testPrisma };
