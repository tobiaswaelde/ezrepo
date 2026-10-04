import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { ENV } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthenticatedUser } from './types.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  /**
   * Initialize JwtStrategy with its required dependencies.
   *
   * @param prisma - Database client used for persisted application state.
   */
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      issuer: ENV.AUTH_JWT_ISSUER,
      secretOrKey: ENV.AUTH_JWT_SECRET,
    });
  }

  /**
   * Resolve a JWT subject and reject tokens with a stale authentication version.
   *
   * @param payload - Verified JWT claims containing the user ID and authentication version.
   * @returns The current authenticated identity loaded from the database.
   * @throws UnauthorizedException - When the subject does not exist or the authentication version does not match the
   * persisted user.
   */
  async validate(payload: { authVersion?: number; sub: string }): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { avatar: { select: { updatedAt: true } } },
    });
    if (!user || (payload.authVersion ?? 0) !== user.authVersion) throw new UnauthorizedException();
    return {
      authProvider: user.authProvider,
      avatarUpdatedAt: user.avatar?.updatedAt ?? null,
      firstName: user.firstName,
      id: user.id,
      lastName: user.lastName,
      role: user.role,
      username: user.username,
    };
  }
}
