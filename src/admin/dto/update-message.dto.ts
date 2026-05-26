import { ApiProperty } from '@nestjs/swagger';

export class UpdateMessageDto {
  @ApiProperty({
    enum: ['approve', 'dismiss'],
    description: 'Admin action on a flagged message',
    example: 'approve',
  })
  action: 'approve' | 'dismiss';
}
