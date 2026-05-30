import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

// All fields are optional — partial updates using dynamic SET clause
export class UpdateProfileDto {
  @ApiProperty({ example: 'Anirban Sen', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    example: '12, Park Street, Kolkata - 700016',
    required: false,
  })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ example: '+919876543210', required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({
    description: 'Advocate contact email (separate from user login email)',
    example: 'advocate@example.com',
    required: false,
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    description: 'Bar Enrolment Number',
    example: 'WB/1234/2018',
    required: false,
  })
  @IsOptional()
  @IsString()
  barEnrolmentNumber?: string;

  @ApiProperty({
    description: 'State Bar Council name',
    example: 'West Bengal',
    required: false,
  })
  @IsOptional()
  @IsString()
  stateBar?: string;

  @ApiProperty({
    description: 'Areas of legal practice',
    example: ['motor_vehicle', 'consumer'],
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  practiceAreas?: string[];

  @ApiProperty({
    description: 'Courts where the advocate practices',
    example: ['Calcutta HC', 'Howrah District Court'],
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  courts?: string[];

  @ApiProperty({
    description: 'Languages the advocate can communicate in',
    example: ['bn', 'en'],
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  @ApiProperty({
    description: 'Districts the advocate serves',
    example: ['howrah', 'kolkata'],
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  districts?: string[];

  @ApiProperty({
    description: 'Short professional bio shown on public profile',
    example: 'Specialising in tenancy and property disputes with 6 years of practice at Calcutta High Court.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  bio?: string;
}
