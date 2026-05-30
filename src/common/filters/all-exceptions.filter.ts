import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Global error envelope (E-6 / L-5). Success responses are wrapped by
 * ResponseEnvelopeInterceptor as { success:true, data, meta }. Interceptors do NOT
 * run on throw, so without this filter errors returned Nest's raw shape and the
 * frontend had two contracts. This wraps every error as:
 *
 *   { success:false, error:{ code, message }, meta:{ timestamp, requestId } }
 *
 * - `code`: the HTTP status number (e.g. 400, 404, 409, 500).
 * - `message`: string, or string[] for class-validator failures.
 *
 * See Implementation_Plans/VALIDATION_TRACKING.md (error-shape section) for the FE contract.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (res && typeof res === 'object') {
        // Nest packs validation/most errors as { statusCode, message, error }
        const m = (res as Record<string, unknown>).message;
        message = (m as string | string[]) ?? exception.message;
      } else {
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      // Unexpected (non-HTTP) error — log the detail server-side, return a generic message.
      this.logger.error(exception.message, exception.stack);
    }

    response.status(status).json({
      success: false,
      error: {
        code: status,
        message,
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: randomUUID(),
      },
    });
  }
}
