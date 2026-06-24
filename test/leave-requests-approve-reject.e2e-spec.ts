import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './utils/create-test-app';
import {
  disconnectTestDb,
  EMPLOYEE_001,
  EMPLOYEE_001_STARTING_BALANCE,
  EMPLOYEE_002,
  resetDatabase,
  testPrisma,
} from './utils/reset-db';
import { asResponseBody } from './utils/response-body';

interface LeaveRequestDetails {
  id: string;
  status: string;
  daysRequested: number;
}

async function submitAnnualLeave(
  app: INestApplication<App>,
  employeeId: string,
  startDate: string,
  endDate: string,
) {
  const res = await request(app.getHttpServer())
    .post('/leave-requests')
    .send({ employeeId, leaveType: 'ANNUAL', startDate, endDate })
    .expect(201);
  return asResponseBody<LeaveRequestDetails>(res.body).details;
}

describe('POST /leave-requests/:id/approve and /reject', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  it('approves a PENDING ANNUAL request and deducts the balance', async () => {
    const created = await submitAnnualLeave(
      app,
      EMPLOYEE_001,
      '2026-08-01',
      '2026-08-03',
    ); // 3 days

    const res = await request(app.getHttpServer())
      .post(`/leave-requests/${created.id}/approve`)
      .set('X-Approver-Id', 'manager-001')
      .expect(200);

    const body = asResponseBody<LeaveRequestDetails>(res.body);
    expect(body.details.status).toBe('APPROVED');

    const employee = await testPrisma.employee.findUniqueOrThrow({
      where: { id: EMPLOYEE_001 },
    });
    expect(employee.annualLeaveBalance).toBe(EMPLOYEE_001_STARTING_BALANCE - 3);
  });

  it('approving SICK/UNPAID leave does not touch the balance', async () => {
    const res1 = await request(app.getHttpServer())
      .post('/leave-requests')
      .send({
        employeeId: EMPLOYEE_002,
        leaveType: 'SICK',
        startDate: '2026-08-01',
        endDate: '2026-08-01',
        reason: 'Flu',
      })
      .expect(201);
    const created = asResponseBody<LeaveRequestDetails>(res1.body).details;

    await request(app.getHttpServer())
      .post(`/leave-requests/${created.id}/approve`)
      .set('X-Approver-Id', 'manager-001')
      .expect(200);

    const employee = await testPrisma.employee.findUniqueOrThrow({
      where: { id: EMPLOYEE_002 },
    });
    expect(employee.annualLeaveBalance).toBe(18);
  });

  it('does not deduct the balance twice when approve is called twice sequentially (retry)', async () => {
    const created = await submitAnnualLeave(
      app,
      EMPLOYEE_001,
      '2026-08-01',
      '2026-08-05',
    ); // 5 days

    await request(app.getHttpServer())
      .post(`/leave-requests/${created.id}/approve`)
      .set('X-Approver-Id', 'manager-001')
      .expect(200);

    const second = await request(app.getHttpServer())
      .post(`/leave-requests/${created.id}/approve`)
      .set('X-Approver-Id', 'manager-001')
      .expect(200);

    expect(
      asResponseBody<LeaveRequestDetails>(second.body).details.status,
    ).toBe('APPROVED');

    const employee = await testPrisma.employee.findUniqueOrThrow({
      where: { id: EMPLOYEE_001 },
    });
    expect(employee.annualLeaveBalance).toBe(EMPLOYEE_001_STARTING_BALANCE - 5);
  });

  it('does not deduct the balance twice when two approve requests race concurrently', async () => {
    const created = await submitAnnualLeave(
      app,
      EMPLOYEE_001,
      '2026-08-01',
      '2026-08-04',
    ); // 4 days

    const [res1, res2] = await Promise.all([
      request(app.getHttpServer())
        .post(`/leave-requests/${created.id}/approve`)
        .set('X-Approver-Id', 'manager-001'),
      request(app.getHttpServer())
        .post(`/leave-requests/${created.id}/approve`)
        .set('X-Approver-Id', 'manager-002'),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const employee = await testPrisma.employee.findUniqueOrThrow({
      where: { id: EMPLOYEE_001 },
    });
    expect(employee.annualLeaveBalance).toBe(EMPLOYEE_001_STARTING_BALANCE - 4);
  });

  it('cannot approve an already-rejected request', async () => {
    const created = await submitAnnualLeave(
      app,
      EMPLOYEE_001,
      '2026-08-01',
      '2026-08-02',
    );
    await request(app.getHttpServer())
      .post(`/leave-requests/${created.id}/reject`)
      .set('X-Approver-Id', 'manager-001')
      .send({ comment: 'No coverage available' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/leave-requests/${created.id}/approve`)
      .set('X-Approver-Id', 'manager-001')
      .expect(409);
  });

  it('404s when approving a non-existent request', async () => {
    await request(app.getHttpServer())
      .post('/leave-requests/00000000-0000-0000-0000-000000000000/approve')
      .set('X-Approver-Id', 'manager-001')
      .expect(404);
  });

  it('400s when approve is called without X-Approver-Id', async () => {
    const created = await submitAnnualLeave(
      app,
      EMPLOYEE_001,
      '2026-08-01',
      '2026-08-02',
    );
    await request(app.getHttpServer())
      .post(`/leave-requests/${created.id}/approve`)
      .expect(400);
  });

  it('rejects a PENDING request with a comment and leaves the balance untouched', async () => {
    const created = await submitAnnualLeave(
      app,
      EMPLOYEE_001,
      '2026-08-01',
      '2026-08-02',
    );

    const res = await request(app.getHttpServer())
      .post(`/leave-requests/${created.id}/reject`)
      .set('X-Approver-Id', 'manager-001')
      .send({ comment: 'Team is short-staffed that week' })
      .expect(200);

    expect(asResponseBody<LeaveRequestDetails>(res.body).details.status).toBe(
      'REJECTED',
    );

    const employee = await testPrisma.employee.findUniqueOrThrow({
      where: { id: EMPLOYEE_001 },
    });
    expect(employee.annualLeaveBalance).toBe(EMPLOYEE_001_STARTING_BALANCE);
  });

  it('requires a comment to reject', async () => {
    const created = await submitAnnualLeave(
      app,
      EMPLOYEE_001,
      '2026-08-01',
      '2026-08-02',
    );
    await request(app.getHttpServer())
      .post(`/leave-requests/${created.id}/reject`)
      .set('X-Approver-Id', 'manager-001')
      .send({})
      .expect(400);
  });

  it('rejecting twice is idempotent and keeps the original comment', async () => {
    const created = await submitAnnualLeave(
      app,
      EMPLOYEE_001,
      '2026-08-01',
      '2026-08-02',
    );

    await request(app.getHttpServer())
      .post(`/leave-requests/${created.id}/reject`)
      .set('X-Approver-Id', 'manager-001')
      .send({ comment: 'original comment' })
      .expect(200);

    const second = await request(app.getHttpServer())
      .post(`/leave-requests/${created.id}/reject`)
      .set('X-Approver-Id', 'manager-001')
      .send({ comment: 'a different comment' })
      .expect(200);

    const stored = await testPrisma.leaveRequest.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(stored.rejectionComment).toBe('original comment');
    expect(
      asResponseBody<LeaveRequestDetails>(second.body).details.status,
    ).toBe('REJECTED');
  });

  it('cannot reject an already-approved request', async () => {
    const created = await submitAnnualLeave(
      app,
      EMPLOYEE_001,
      '2026-08-01',
      '2026-08-02',
    );
    await request(app.getHttpServer())
      .post(`/leave-requests/${created.id}/approve`)
      .set('X-Approver-Id', 'manager-001')
      .expect(200);

    await request(app.getHttpServer())
      .post(`/leave-requests/${created.id}/reject`)
      .set('X-Approver-Id', 'manager-001')
      .send({ comment: 'trying to reject after approval' })
      .expect(409);
  });
});
