import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PostMessageDto {
  @ApiProperty({ description: "The citizen's message for this turn", maxLength: 4000 })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message: string;
}
