import { ApiProperty } from '@nestjs/swagger';

// Called right after OTP verification with a generic JWT.
// Creates the advocate row and re-issues a JWT with role = 'advocate'.
export class RegisterAdvocateDto {
  @ApiProperty({
    description: 'Bar Enrolment Number as printed on the Certificate of Practice',
    example: 'WB/1234/2018',
  })
  barEnrolmentNumber: string;

  @ApiProperty({ description: 'State Bar Council name', example: 'West Bengal' })
  stateBar: string;
}
