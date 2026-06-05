import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMatterDto {
  @ApiProperty({
    description: 'Legal question in Bengali or English',
    example: 'আমার মালিক বিনা নোটিশে আমাকে উচ্ছেদ করতে চাইছেন।',
  })
  @IsString()
  @MinLength(20)
  @MaxLength(2000)
  query: string;

  @ApiProperty({
    description: 'Language of the query',
    example: 'bn',
    enum: ['bn', 'en'],
  })
  @IsIn(['bn', 'en'])
  language: 'bn' | 'en';
}
