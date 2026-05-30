import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateUserProfileDto {
  @ApiProperty({ example: 'Parambrata Ghosh', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: '12 Park Street, Kolkata 700016', required: false })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ example: 'bn', enum: ['bn', 'en'], required: false })
  @IsOptional()
  @IsIn(['bn', 'en'])
  preferred_language?: string;
}
