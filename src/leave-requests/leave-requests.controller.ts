import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  APPROVER_ID_HEADER,
  DEFAULT_TENANT_ID,
  TENANT_HEADER,
} from '../common/constants/headers';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { RejectLeaveRequestDto } from './dto/reject-leave-request.dto';
import { LeaveRequestsService } from './leave-requests.service';

@Controller('leave-requests')
export class LeaveRequestsController {
  constructor(private readonly leaveRequestsService: LeaveRequestsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateLeaveRequestDto,
    @Headers(TENANT_HEADER) tenantId?: string,
  ) {
    return this.leaveRequestsService.create(tenantId ?? DEFAULT_TENANT_ID, dto);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
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
