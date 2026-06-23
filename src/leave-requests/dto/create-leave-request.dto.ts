import { ApiProperty } from '@nestjs/swagger';
import { LeaveType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateLeaveRequestDto {
  @ApiProperty({ example: 'employee-001' })
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @ApiProperty({ enum: LeaveType, example: LeaveType.ANNUAL })
  @IsEnum(LeaveType)
  leaveType!: LeaveType;

  @ApiProperty({ example: '2026-07-01' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-07-03' })
  @IsDateString()
  endDate!: string;

  @ApiProperty({
    required: false,
    description: 'Optional for ANNUAL, required for SICK and UNPAID',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
