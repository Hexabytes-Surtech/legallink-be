import { AllExceptionsFilter } from './all-exceptions.filter';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ArgumentsHost } from '@nestjs/common';

// Builds a fake ArgumentsHost whose response captures status()/json() calls.
function makeHost() {
  const captured: { status?: number; body?: any } = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(body: any) {
      captured.body = body;
      return res;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { host, captured };
}

describe('AllExceptionsFilter (E-6 error envelope)', () => {
  const filter = new AllExceptionsFilter();

  it('wraps a string HttpException as { success:false, error:{code,message}, meta }', () => {
    const { host, captured } = makeHost();
    filter.catch(new ConflictException('SLOT_ALREADY_BOOKED'), host);

    expect(captured.status).toBe(HttpStatus.CONFLICT); // 409
    expect(captured.body.success).toBe(false);
    expect(captured.body.error).toEqual({ code: 409, message: 'SLOT_ALREADY_BOOKED' });
    expect(captured.body.meta).toEqual(
      expect.objectContaining({
        timestamp: expect.any(String),
        requestId: expect.any(String),
      }),
    );
  });

  it('preserves class-validator string[] messages', () => {
    const { host, captured } = makeHost();
    // Nest packs validation errors as { statusCode, message: string[], error }
    filter.catch(
      new BadRequestException({
        statusCode: 400,
        message: ['email must be an email', 'role must be one of the following values'],
        error: 'Bad Request',
      }),
      host,
    );

    expect(captured.status).toBe(400);
    expect(captured.body.success).toBe(false);
    expect(captured.body.error.code).toBe(400);
    expect(Array.isArray(captured.body.error.message)).toBe(true);
    expect(captured.body.error.message).toContain('email must be an email');
  });

  it('maps a custom HttpException status (e.g. 429) correctly', () => {
    const { host, captured } = makeHost();
    filter.catch(
      new HttpException({ message: 'OTP_LOCKED', retryAfterSec: 60 }, HttpStatus.TOO_MANY_REQUESTS),
      host,
    );
    expect(captured.status).toBe(429);
    expect(captured.body.error.code).toBe(429);
  });

  it('falls back to 500 + generic message for a non-HTTP error', () => {
    const { host, captured } = makeHost();
    filter.catch(new Error('db exploded'), host);

    expect(captured.status).toBe(500);
    expect(captured.body.success).toBe(false);
    expect(captured.body.error.code).toBe(500);
    // raw internal error text is NOT leaked to the client
    expect(captured.body.error.message).toBe('Internal server error');
  });
});
