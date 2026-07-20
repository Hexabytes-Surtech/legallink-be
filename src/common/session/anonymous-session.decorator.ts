import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Returns the anonymous session UUID set by SessionMiddleware. */
export const AnonymousSessionId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const req = ctx.switchToHttp().getRequest();
    return req.anonymousSessionId;
  },
);
