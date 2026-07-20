import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';

// Query filters are intentionally loose: each param may arrive as a string OR a
// repeated array (e.g. ?practiceArea=civil&practiceArea=family). The service does
// the parsing/clamping. @IsOptional() here only ensures whitelist keeps the field.
export class AdvocatesQueryDto {
  @ApiPropertyOptional({
    description: 'Free-text search across name, bio, state bar, practice areas and districts',
  })
  @IsOptional()
  q?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Filter by practice areas (repeat param for multiple: ?practiceArea=civil&practiceArea=family)',
  })
  @IsOptional()
  practiceArea?: string | string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Filter by language codes (en, bn, hi)',
  })
  @IsOptional()
  language?: string | string[];

  @ApiPropertyOptional({ description: 'Filter by a single district slug' })
  @IsOptional()
  district?: string;

  @ApiPropertyOptional({
    description: 'Return only verified advocates (default: true)',
    default: 'true',
  })
  @IsOptional()
  verifiedOnly?: string;

  @ApiPropertyOptional({ description: 'Page number (default: 1)' })
  @IsOptional()
  page?: string;

  @ApiPropertyOptional({ description: 'Results per page, max 50 (default: 10)' })
  @IsOptional()
  limit?: string;
}
