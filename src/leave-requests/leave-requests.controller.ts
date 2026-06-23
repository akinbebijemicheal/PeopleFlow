import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  APPROVER_ID_HEADER,
  DEFAULT_TENANT_ID,
  TENANT_HEADER,
} from '../common/constants/headers';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { ListLeaveRequestsQueryDto } from './dto/list-leave-requests-query.dto';
import { RejectLeaveRequestDto } from './dto/reject-leave-request.dto';
import { LeaveRequestsService } from './leave-requests.service';

@ApiTags('leave-requests')
@ApiHeader({
  name: TENANT_HEADER,
  required: false,
  description: `Defaults to ${DEFAULT_TENANT_ID}`,
})
@Controller('leave-requests')
export class LeaveRequestsController {
  constructor(private readonly leaveRequestsService: LeaveRequestsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List leave requests, optionally filtered by status and/or employeeId',
  })
  findAll(
    @Query() query: ListLeaveRequestsQueryDto,
    @Headers(TENANT_HEADER) tenantId?: string,
  ) {
    return this.leaveRequestsService.findAll(
      tenantId ?? DEFAULT_TENANT_ID,
      query,
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a leave request (enters PENDING)' })
  create(
    @Body() dto: CreateLeaveRequestDto,
    @Headers(TENANT_HEADER) tenantId?: string,
  ) {
    return this.leaveRequestsService.create(tenantId ?? DEFAULT_TENANT_ID, dto);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a PENDING leave request (idempotent on retry)',
  })
  @ApiHeader({ name: APPROVER_ID_HEADER, required: true })
  approve(
    @Param('id') id: string,
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Headers(APPROVER_ID_HEADER) approverId: string | undefined,
  ) {
    if (!approverId) {
      throw new BadRequestException(`${APPROVER_ID_HEADER} header is required`);
    }
    return this.leaveRequestsService.approve(
      tenantId ?? DEFAULT_TENANT_ID,
      id,
      approverId,
    );
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a PENDING leave request' })
  @ApiHeader({ name: APPROVER_ID_HEADER, required: true })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectLeaveRequestDto,
    @Headers(TENANT_HEADER) tenantId: string | undefined,
    @Headers(APPROVER_ID_HEADER) approverId: string | undefined,
  ) {
    if (!approverId) {
      throw new BadRequestException(`${APPROVER_ID_HEADER} header is required`);
    }
    return this.leaveRequestsService.reject(
      tenantId ?? DEFAULT_TENANT_ID,
      id,
      approverId,
      dto,
    );
  }
}
