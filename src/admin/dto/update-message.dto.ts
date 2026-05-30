import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class UpdateMessageDto {
  @ApiProperty({
    enum: ['approve', 'dismiss'],
    description: 'Admin action on a flagged message',
    example: 'approve',
  })
  @IsIn(['approve', 'dismiss'])
  action: 'approve' | 'dismiss';
}
