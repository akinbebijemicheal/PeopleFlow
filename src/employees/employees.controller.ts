import { Controller, Get, Headers, Param } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DEFAULT_TENANT_ID, TENANT_HEADER } from '../common/constants/headers';
import { EmployeesService } from './employees.service';

@ApiTags('employees')
@ApiHeader({
  name: TENANT_HEADER,
  required: false,
  description: `Defaults to ${DEFAULT_TENANT_ID}`,
})
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get(':employeeId/leave-balance')
  @ApiOperation({ summary: "Get an employee's remaining annual leave balance" })
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
