import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// The advanceable case-timeline stages. 'closed' is NOT here — a consultation only
// reaches the terminal 'closed' stage through the close flow (PUT :id/close), which
// also records the closure outcome. This keeps the two states from drifting.
export const TIMELINE_STAGES = [
  'consultation_started',
  'advice_review',
  'drafting',
  'legal_notice',
  'filed_in_court',
  'in_hearing',
] as const;

export type TimelineStage = (typeof TIMELINE_STAGES)[number];

export class UpdateStageDto {
  @ApiProperty({
    enum: TIMELINE_STAGES,
    description: 'The stage to move the consultation to',
    example: 'drafting',
  })
  @IsIn(TIMELINE_STAGES)
  stageKey: TimelineStage;

  @ApiProperty({
    description: 'Optional note explaining the transition (shown to the citizen)',
    example: 'Reviewed your rent agreement; drafting a legal notice next.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
