import { ApiProperty } from '@nestjs/swagger';

export class UpdateUserProfileDto {
  @ApiProperty({ example: 'Parambrata Ghosh', required: false })
  name?: string;

  @ApiProperty({ example: '12 Park Street, Kolkata 700016', required: false })
  address?: string;

  @ApiProperty({ example: 'bn', enum: ['bn', 'en'], required: false })
  preferred_language?: string;
}
