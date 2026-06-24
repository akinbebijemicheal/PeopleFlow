import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './utils/create-test-app';
import {
  disconnectTestDb,
  EMPLOYEE_001,
  EMPLOYEE_002,
  resetDatabase,
} from './utils/reset-db';
import { asResponseBody } from './utils/response-body';

interface LeaveRequestDetails {
  status: string;
  daysRequested: number;
}

describe('POST /leave-requests', () => {
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

  it('submits a valid ANNUAL leave request and returns PENDING', async () => {
    const res = await request(app.getHttpServer())
      .post('/leave-requests')
      .send({
        employeeId: EMPLOYEE_001,
        leaveType: 'ANNUAL',
        startDate: '2026-08-01',
        endDate: '2026-08-03',
      })
      .expect(201);

    const body = asResponseBody<LeaveRequestDetails>(res.body);
    expect(body.status).toBe('success');
    expect(body.details.status).toBe('PENDING');
    expect(body.details.daysRequested).toBe(3);
  });

  it('rejects when endDate is before startDate', async () => {
    const res = await request(app.getHttpServer())
      .post('/leave-requests')
      .send({
        employeeId: EMPLOYEE_001,
        leaveType: 'ANNUAL',
        startDate: '2026-08-05',
        endDate: '2026-08-01',
      })
      .expect(400);

    const body = asResponseBody(res.body);
    expect(body.status).toBe('failure');
    expect(body.responseMessage).toMatch(
      /endDate must be on or after startDate/,
    );
  });

  it('rejects leave submitted entirely in the past', async () => {
    const res = await request(app.getHttpServer())
      .post('/leave-requests')
      .send({
        employeeId: EMPLOYEE_001,
        leaveType: 'ANNUAL',
        startDate: '2020-01-01',
        endDate: '2020-01-02',
      })
      .expect(400);

    const body = asResponseBody(res.body);
    expect(body.responseMessage).toMatch(/entirely in the past/);
  });

  it('rejects an overlapping PENDING request for the same employee', async () => {
    await request(app.getHttpServer())
      .post('/leave-requests')
      .send({
        employeeId: EMPLOYEE_001,
        leaveType: 'ANNUAL',
        startDate: '2026-08-10',
        endDate: '2026-08-12',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/leave-requests')
      .send({
        employeeId: EMPLOYEE_001,
        leaveType: 'ANNUAL',
        startDate: '2026-08-11',
        endDate: '2026-08-15',
      })
      .expect(409);

    const body = asResponseBody(res.body);
    expect(body.responseMessage).toMatch(/overlapping|pending or approved/i);
  });

  it('rejects ANNUAL leave that exceeds the remaining balance', async () => {
    const res = await request(app.getHttpServer())
      .post('/leave-requests')
      .send({
        employeeId: EMPLOYEE_001,
        leaveType: 'ANNUAL',
        startDate: '2026-09-01',
        endDate: '2026-09-20', // 20 days, balance is 10
      })
      .expect(422);

    const body = asResponseBody(res.body);
    expect(body.responseMessage).toMatch(/insufficient annual leave balance/i);
  });

  it('requires a reason for SICK leave', async () => {
    const res = await request(app.getHttpServer())
      .post('/leave-requests')
      .send({
        employeeId: EMPLOYEE_002,
        leaveType: 'SICK',
        startDate: '2026-08-01',
        endDate: '2026-08-01',
      })
      .expect(400);

    const body = asResponseBody(res.body);
    expect(body.responseMessage).toMatch(/reason is required for SICK/);
  });

  it('requires at least 20 characters of reason for SICK leave longer than 3 days', async () => {
    const res = await request(app.getHttpServer())
      .post('/leave-requests')
      .send({
        employeeId: EMPLOYEE_002,
        leaveType: 'SICK',
        startDate: '2026-08-01',
        endDate: '2026-08-05',
        reason: 'flu',
      })
      .expect(400);

    const body = asResponseBody(res.body);
    expect(body.responseMessage).toMatch(/at least 20 characters/);
  });

  it('accepts SICK leave longer than 3 days with a sufficiently long reason', async () => {
    const res = await request(app.getHttpServer())
      .post('/leave-requests')
      .send({
        employeeId: EMPLOYEE_002,
        leaveType: 'SICK',
        startDate: '2026-08-01',
        endDate: '2026-08-05',
        reason: 'Diagnosed with severe flu, doctor ordered bed rest',
      })
      .expect(201);

    const body = asResponseBody<LeaveRequestDetails>(res.body);
    expect(body.details.status).toBe('PENDING');
  });

  it('requires a reason for UNPAID leave', async () => {
    const res = await request(app.getHttpServer())
      .post('/leave-requests')
      .send({
        employeeId: EMPLOYEE_002,
        leaveType: 'UNPAID',
        startDate: '2026-08-01',
        endDate: '2026-08-02',
      })
      .expect(400);

    const body = asResponseBody(res.body);
    expect(body.responseMessage).toMatch(/reason is required for UNPAID/);
  });

  it('rejects unknown fields on the request body', async () => {
    await request(app.getHttpServer())
      .post('/leave-requests')
      .send({
        employeeId: EMPLOYEE_001,
        leaveType: 'ANNUAL',
        startDate: '2026-08-01',
        endDate: '2026-08-02',
        notAField: 'should be rejected',
      })
      .expect(400);
  });

  it('404s when the employee does not exist', async () => {
    await request(app.getHttpServer())
      .post('/leave-requests')
      .send({
        employeeId: 'no-such-employee',
        leaveType: 'ANNUAL',
        startDate: '2026-08-01',
        endDate: '2026-08-02',
      })
      .expect(404);
  });
});
