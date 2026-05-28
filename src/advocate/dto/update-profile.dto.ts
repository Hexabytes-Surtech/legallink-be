import { ApiProperty } from '@nestjs/swagger';

// All fields are optional — partial updates using dynamic SET clause
export class UpdateProfileDto {
  @ApiProperty({ example: 'Anirban Sen', required: false })
  name?: string;

  @ApiProperty({
    example: '12, Park Street, Kolkata - 700016',
    required: false,
  })
  address?: string;

  @ApiProperty({ example: '+919876543210', required: false })
  phone?: string;

  @ApiProperty({
    description: 'Advocate contact email (separate from user login email)',
    example: 'advocate@example.com',
    required: false,
  })
  email?: string;

  @ApiProperty({
    description: 'Bar Enrolment Number',
    example: 'WB/1234/2018',
    required: false,
  })
  barEnrolmentNumber?: string;

  @ApiProperty({
    description: 'State Bar Council name',
    example: 'West Bengal',
    required: false,
  })
  stateBar?: string;

  @ApiProperty({
    description: 'Areas of legal practice',
    example: ['motor_vehicle', 'consumer'],
    type: [String],
    required: false,
  })
  practiceAreas?: string[];

  @ApiProperty({
    description: 'Courts where the advocate practices',
    example: ['Calcutta HC', 'Howrah District Court'],
    type: [String],
    required: false,
  })
  courts?: string[];

  @ApiProperty({
    description: 'Languages the advocate can communicate in',
    example: ['bn', 'en'],
    type: [String],
    required: false,
  })
  languages?: string[];

  @ApiProperty({
    description: 'Districts the advocate serves',
    example: ['howrah', 'kolkata'],
    type: [String],
    required: false,
  })
  districts?: string[];

  @ApiProperty({
    description: 'Short professional bio shown on public profile',
    example: 'Specialising in tenancy and property disputes with 6 years of practice at Calcutta High Court.',
    required: false,
  })
  bio?: string;
}
