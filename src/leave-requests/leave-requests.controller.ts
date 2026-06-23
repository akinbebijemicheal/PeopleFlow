import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { DEFAULT_TENANT_ID, TENANT_HEADER } from '../common/constants/tenant';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
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
}
