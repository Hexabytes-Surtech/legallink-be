import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const CANONICAL_MATTER_TYPES = ['Criminal', 'Civil', 'Family', 'Labour', 'Tenancy', 'Traffic', 'Consumer'] as const;
const OUTCOMES = ['won', 'settled', 'ongoing'] as const;

export class AddCaseHistoryDto {
  @ApiProperty({ example: 'Labour', enum: CANONICAL_MATTER_TYPES })
  @IsIn(CANONICAL_MATTER_TYPES)
  matter_type: string;

  @ApiProperty({ example: 'Alipore District Court' })
  @IsString()
  @MaxLength(200)
  court: string;

  @ApiProperty({ example: 'South 24 Parganas' })
  @IsString()
  @MaxLength(100)
  district: string;

  @ApiProperty({ example: 'won', enum: OUTCOMES })
  @IsIn(OUTCOMES)
  outcome: string;

  @ApiProperty({ example: 2022, required: false })
  @IsOptional()
  @IsInt()
  @Min(1950)
  @Max(2100)
  year?: number;

  @ApiProperty({ example: 'Unpaid wages dispute resolved in favour of the worker.', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
