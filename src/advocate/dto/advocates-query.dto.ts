import { ApiPropertyOptional } from '@nestjs/swagger';

export class AdvocatesQueryDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Filter by practice areas (repeat param for multiple: ?practiceArea=civil&practiceArea=family)',
  })
  practiceArea?: string | string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Filter by language codes (en, bn, hi)',
  })
  language?: string | string[];

  @ApiPropertyOptional({ description: 'Filter by a single district slug' })
  district?: string;

  @ApiPropertyOptional({
    description: 'Return only verified advocates (default: true)',
    default: 'true',
  })
  verifiedOnly?: string;

  @ApiPropertyOptional({ description: 'Page number (default: 1)' })
  page?: string;

  @ApiPropertyOptional({ description: 'Results per page, max 50 (default: 10)' })
  limit?: string;
}
