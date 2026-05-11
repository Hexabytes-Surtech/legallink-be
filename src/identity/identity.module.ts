import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { DatabaseModule } from '../database/database.module';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    DatabaseModule,
    PassportModule,
    // JwtModule registered without a default secret —
    // each sign/verify call passes its own secret explicitly
    JwtModule.register({}),
  ],
  controllers: [IdentityController],
  providers: [IdentityService, JwtStrategy],
  // Export so other modules (advocate, admin) can call issueTokens()
  exports: [IdentityService, JwtModule],
})
export class IdentityModule {}
