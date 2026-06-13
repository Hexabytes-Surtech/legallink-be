import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// Closure outcomes, grounded in real Indian practice + court-disposal vocabulary.
// 'withdrawn_by_client' is the citizen's absolute right and the only outcome a citizen
// close may produce; advocates may pick any of these.
export const CLOSURE_OUTCOMES = [
  'resolved', // Resolved / advice complete
  'settled', // Settled / compromise
  'withdrawn_by_client', // Client withdrew (absolute right, no consent needed)
  'referred', // Referred / transferred to another advocate
  'advice_only', // Advice-only — no further action needed
  'ended_early', // Closed without resolution — engagement ended early
  'dismissed_procedure', // Dismissed on procedure (no merits decision)
  'decided_unfavourably', // Decided unfavourably / lost on merits
] as const;

export type ClosureOutcome = (typeof CLOSURE_OUTCOMES)[number];

export class CloseConsultationDto {
  // Optional at the DTO layer so the long-standing citizen close (empty body) still
  // validates. The service REQUIRES it for an advocate close, and forces
  // 'withdrawn_by_client' for a citizen close.
  @ApiProperty({
    enum: CLOSURE_OUTCOMES,
    description: 'Closure outcome (advocate close: required; citizen close: forced to withdrawn_by_client)',
    example: 'resolved',
    required: false,
  })
  @IsOptional()
  @IsIn(CLOSURE_OUTCOMES)
  outcomeKey?: ClosureOutcome;

  @ApiProperty({
    description: 'Closing summary / advice given (the Consultation Closure Summary narrative)',
    example: 'Advised that the deposit is recoverable under the rent agreement; sent a legal notice. Client to await response within 15 days.',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  summary?: string;

  @ApiProperty({ description: 'Settlement / compromise terms (when outcome = settled)', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  settlement?: string;

  @ApiProperty({ description: 'New advocate reference (when outcome = referred)', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  newAdvocate?: string;

  @ApiProperty({ description: 'No-Objection Certificate issued to the new advocate (when outcome = referred)', required: false })
  @IsOptional()
  @IsBoolean()
  nocIssued?: boolean;

  @ApiProperty({ description: 'Next steps / appeal timeline (when outcome = dismissed_procedure or decided_unfavourably)', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  nextSteps?: string;

  @ApiProperty({ description: 'BCI duty: client documents / case file returned to the client', required: false })
  @IsOptional()
  @IsBoolean()
  documentsReturned?: boolean;

  @ApiProperty({ description: 'BCI duty: fees settled / no dues', required: false })
  @IsOptional()
  @IsBoolean()
  feesSettled?: boolean;
}
