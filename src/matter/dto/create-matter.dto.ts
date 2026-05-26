import { ApiProperty } from '@nestjs/swagger';

export class CreateMatterDto {
  @ApiProperty({
    description: 'Legal question in Bengali or English',
    example: 'আমার মালিক বিনা নোটিশে আমাকে উচ্ছেদ করতে চাইছেন।',
  })
  query: string;

  @ApiProperty({
    description: 'Language of the query',
    example: 'bn',
    enum: ['bn', 'en'],
  })
  language: 'bn' | 'en';
}
