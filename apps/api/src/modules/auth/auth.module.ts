import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { CaslModule } from '../../casl/casl.module.js';
import { ENV } from '../../config/env.js';
import { SecurityModule } from '../../security/security.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AvatarService } from './avatar.service.js';
import { JwtStrategy } from './jwt.strategy.js';
import { OidcController } from './oidc/oidc.controller.js';
import { OidcService } from './oidc/oidc.service.js';
import { UsersQueryService } from './users-query.service.js';
import { UsersController } from './users.controller.js';

@Module({
  imports: [
    CaslModule,
    SecurityModule,
    PassportModule,
    JwtModule.register({
      secret: ENV.AUTH_JWT_SECRET,
      signOptions: {
        expiresIn: ENV.AUTH_JWT_EXPIRATION as never,
        issuer: ENV.AUTH_JWT_ISSUER,
      },
    }),
  ],
  controllers: [AuthController, OidcController, UsersController],
  providers: [AuthService, AvatarService, JwtStrategy, OidcService, UsersQueryService],
  exports: [AuthService],
})
export class AuthModule {}
