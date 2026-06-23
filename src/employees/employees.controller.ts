import { Controller, Get, Headers, Param } from '@nestjs/common';
import { DEFAULT_TENANT_ID, TENANT_HEADER } from '../common/constants/headers';
import { EmployeesService } from './employees.service';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get(':employeeId/leave-balance')
  getLeaveBalance(
    @Param('employeeId') employeeId: string,
    @Headers(TENANT_HEADER) tenantId?: string,
  ) {
    return this.employeesService.getLeaveBalance(
      tenantId ?? DEFAULT_TENANT_ID,
      employeeId,
    );
  }
}
