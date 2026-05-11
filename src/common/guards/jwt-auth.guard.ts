import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Extends passport's JWT guard — automatically validates Bearer token
// and attaches the decoded payload to req.user
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
