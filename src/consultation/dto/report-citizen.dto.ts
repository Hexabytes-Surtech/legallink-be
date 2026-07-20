import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const REPORT_REASONS = [
  'abusive',
  'spam',
  'ended_unfairly',
  'off_platform_contact',
  'other',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export class ReportCitizenDto {
  @ApiProperty({
    enum: REPORT_REASONS,
    description: 'Category of the complaint against the citizen',
    example: 'abusive',
  })
  @IsIn(REPORT_REASONS)
  reason: ReportReason;

  @ApiProperty({
    description: 'Free-text detail for the admin (optional)',
    example: 'Used abusive language and ended the chat before I could respond.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
