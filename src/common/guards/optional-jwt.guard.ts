import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Allows anonymous requests through (no 401); attaches user to request if token is valid.
// Wraps super.canActivate in try/catch so expired or malformed tokens don't crash anonymous routes.
@Injectable()
export class OptionalJwtGuard extends AuthGuard('jwt') {
  handleRequest(_err: any, user: any) {
    return user ?? null;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      await super.canActivate(context);
    } catch {
      // Ignore auth errors — anonymous access is allowed
    }
    return true;
  }
}
