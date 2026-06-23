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
