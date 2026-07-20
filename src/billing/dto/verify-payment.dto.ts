import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * The three fields Razorpay Checkout hands back to the frontend on a successful
 * payment. We re-derive the HMAC signature server-side to confirm authenticity
 * before activating the subscription.
 */
export class VerifyPaymentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  razorpay_order_id: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  razorpay_payment_id: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  razorpay_signature: string;
}
