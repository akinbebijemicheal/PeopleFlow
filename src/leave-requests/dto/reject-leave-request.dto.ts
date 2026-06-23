import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RejectLeaveRequestDto {
  @ApiProperty({ example: 'Team is short-staffed that week' })
  @IsString()
  @IsNotEmpty()
  comment!: string;
}
