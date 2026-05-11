import { ApiProperty } from '@nestjs/swagger';

// BCI Rule 36 (2008) permits only these six fields on a public profile
export class UpdateProfileDto {
  @ApiProperty({ example: 'Anirban Sen' })
  name: string;

  @ApiProperty({ example: '12, Park Street, Kolkata - 700016' })
  address: string;

  @ApiProperty({ example: '+919876543210' })
  phone: string;

  @ApiProperty({ example: 'advocate@example.com', required: false })
  email?: string;

  @ApiProperty({
    description: 'Areas of legal practice',
    example: ['motor_vehicle', 'consumer'],
    type: [String],
  })
  practiceAreas: string[];

  @ApiProperty({
    description: 'Courts where the advocate practices',
    example: ['Calcutta HC', 'Howrah District Court'],
    type: [String],
  })
  courts: string[];

  @ApiProperty({
    description: 'Languages the advocate can communicate in',
    example: ['bn', 'en'],
    type: [String],
  })
  languages: string[];

  @ApiProperty({
    description: 'Districts the advocate serves',
    example: ['howrah', 'kolkata'],
    type: [String],
  })
  districts: string[];
}
