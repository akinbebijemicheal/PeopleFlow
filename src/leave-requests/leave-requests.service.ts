import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LeaveStatus, LeaveType } from '@prisma/client';
import {
  daysBetweenInclusive,
  todayUtcMidnight,
} from '../common/utils/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { ListLeaveRequestsQueryDto } from './dto/list-leave-requests-query.dto';
import { RejectLeaveRequestDto } from './dto/reject-leave-request.dto';

const SICK_REASON_MIN_LENGTH = 20;
const SICK_CONSECUTIVE_DAYS_THRESHOLD = 3;
const OVERLAPPING_STATUSES: LeaveStatus[] = [
  LeaveStatus.PENDING,
  LeaveStatus.APPROVED,
];

@Injectable()
export class LeaveRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateLeaveRequestDto) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (endDate.getTime() < startDate.getTime()) {
      throw new BadRequestException('endDate must be on or after startDate');
    }

    if (endDate.getTime() < todayUtcMidnight().getTime()) {
      throw new BadRequestException(
        'Leave cannot be submitted for dates entirely in the past',
      );
    }

    const daysRequested = daysBetweenInclusive(startDate, endDate);
    this.validateReason(dto.leaveType, dto.reason, daysRequested);

    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const overlapping = await this.prisma.leaveRequest.findFirst({
      where: {
        tenantId,
        employeeId: dto.employeeId,
        status: { in: OVERLAPPING_STATUSES },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (overlapping) {
      throw new ConflictException(
        'Employee already has a pending or approved leave request for these dates',
      );
    }

    if (
      dto.leaveType === LeaveType.ANNUAL &&
      daysRequested > employee.annualLeaveBalance
    ) {
      throw new UnprocessableEntityException(
        'Insufficient annual leave balance',
      );
    }

    return this.prisma.leaveRequest.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        leaveType: dto.leaveType,
        startDate,
        endDate,
        daysRequested,
        reason: dto.reason,
        status: LeaveStatus.PENDING,
      },
    });
  }

  /**
   * Idempotent on purpose: the UI retries on timeout (see DEBUGGING.md), so a
   * second call for an already-approved request must not throw and must not
   * deduct the balance again. The PENDING -> APPROVED transition itself is a
   * single conditional UPDATE (updateMany with status: PENDING in the WHERE
   * clause), which Postgres can only let one concurrent caller win — the
   * loser's UPDATE re-evaluates against the now-committed row and matches
   * zero rows, so it falls through to "already approved" instead of
   * double-deducting.
   */
  async approve(tenantId: string, id: string, approverId: string) {
    const existing = await this.prisma.leaveRequest.findFirst({
      where: { id, tenantId },
    });
    if (!existing) {
      throw new NotFoundException('Leave request not found');
    }

    if (existing.status === LeaveStatus.APPROVED) {
      return existing;
    }
    if (existing.status === LeaveStatus.REJECTED) {
      throw new ConflictException('Leave request has already been rejected');
    }

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.leaveRequest.updateMany({
        where: { id, tenantId, status: LeaveStatus.PENDING },
        data: {
          status: LeaveStatus.APPROVED,
          approvedBy: approverId,
          approvedAt: new Date(),
        },
      });

      if (count === 0) {
        // Lost the race to a concurrent approval of the same request.
        return tx.leaveRequest.findUniqueOrThrow({ where: { id } });
      }

      if (existing.leaveType === LeaveType.ANNUAL) {
        const { count: balanceUpdated } = await tx.employee.updateMany({
          where: {
            id: existing.employeeId,
            annualLeaveBalance: { gte: existing.daysRequested },
          },
          data: { annualLeaveBalance: { decrement: existing.daysRequested } },
        });
        if (balanceUpdated === 0) {
          throw new UnprocessableEntityException(
            'Insufficient annual leave balance at approval time',
          );
        }
      }

      return tx.leaveRequest.findUniqueOrThrow({ where: { id } });
    });
  }

  /**
   * Same idempotent shape as approve(): a retried reject for an
   * already-rejected request is a no-op, not an error. An already-approved
   * request is a genuine conflict (you can't un-approve via reject).
   */
  async reject(
    tenantId: string,
    id: string,
    approverId: string,
    dto: RejectLeaveRequestDto,
  ) {
    const existing = await this.prisma.leaveRequest.findFirst({
      where: { id, tenantId },
    });
    if (!existing) {
      throw new NotFoundException('Leave request not found');
    }

    if (existing.status === LeaveStatus.REJECTED) {
      return existing;
    }
    if (existing.status === LeaveStatus.APPROVED) {
      throw new ConflictException('Leave request has already been approved');
    }

    const { count } = await this.prisma.leaveRequest.updateMany({
      where: { id, tenantId, status: LeaveStatus.PENDING },
      data: {
        status: LeaveStatus.REJECTED,
        rejectedBy: approverId,
        rejectedAt: new Date(),
        rejectionComment: dto.comment,
      },
    });

    const current = await this.prisma.leaveRequest.findUniqueOrThrow({
      where: { id },
    });
    if (count === 0 && current.status === LeaveStatus.APPROVED) {
      // Lost the race to a concurrent approval of the same request.
      throw new ConflictException('Leave request has already been approved');
    }
    return current;
  }

  findAll(tenantId: string, query: ListLeaveRequestsQueryDto) {
    return this.prisma.leaveRequest.findMany({
      where: {
        tenantId,
        ...(query.status && { status: query.status }),
        ...(query.employeeId && { employeeId: query.employeeId }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private validateReason(
    leaveType: LeaveType,
    reason: string | undefined,
    daysRequested: number,
  ): void {
    if (leaveType === LeaveType.ANNUAL) {
      return;
    }

    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException(
        `reason is required for ${leaveType} leave`,
      );
    }

    if (
      leaveType === LeaveType.SICK &&
      daysRequested > SICK_CONSECUTIVE_DAYS_THRESHOLD &&
      reason.trim().length < SICK_REASON_MIN_LENGTH
    ) {
      throw new BadRequestException(
        `SICK leave longer than ${SICK_CONSECUTIVE_DAYS_THRESHOLD} consecutive days requires a reason of at least ${SICK_REASON_MIN_LENGTH} characters`,
      );
    }
  }
}
