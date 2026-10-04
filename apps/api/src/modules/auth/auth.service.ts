import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';

import { ENV } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthResult, AuthenticatedUser } from './types.js';

interface UpdateProfileInput {
  currentPassword?: string;
  firstName: string | null;
  lastName: string | null;
  username: string;
}

interface SetupInput {
  firstName?: string;
  lastName?: string;
  password: string;
  username: string;
}

const avatarMetadata = { select: { updatedAt: true } } as const;

@Injectable()
export class AuthService {
  /**
   * Initialize AuthService with its required dependencies.
   *
   * @param prisma - Database client used for persisted application state.
   * @param jwt - JWT signer and verifier configured for application authentication.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Verify local credentials and issue an access token with the current authentication version.
   *
   * @param username - Local login name identifying the account.
   * @param password - Plaintext password to verify or hash; never returned or logged.
   * @returns The authenticated identity and its newly signed access token.
   * @throws UnauthorizedException - Invalid credentials.
   */
  async signIn(username: string, password: string): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { username }, include: { avatar: avatarMetadata } });
    if (!user?.passwordHash || user.authProvider === 'OIDC' || !(await bcrypt.compare(password, user.passwordHash)))
      throw new UnauthorizedException('Invalid credentials.');
    const authenticatedUser = this.toAuthenticatedUser(user);
    return { accessToken: await this.createAccessToken(authenticatedUser, user.authVersion), user: authenticatedUser };
  }

  /**
   * Return whether at least one local user has completed first-run setup.
   *
   * @returns Whether at least one local user already exists.
   */
  async getSetupStatus(): Promise<{ initialized: boolean }> {
    return { initialized: (await this.prisma.user.count()) > 0 };
  }

  /**
   * Create exactly one first-run system administrator under a transaction-scoped PostgreSQL lock.
   *
   * @param input - Initial administrator username, password, and optional profile names.
   * @returns The first administrator identity and its access token.
   * @throws ConflictException - The application is already initialized.
   */
  async setup(input: SetupInput): Promise<AuthResult> {
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await this.prisma.transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(1573210845)`;
      if ((await transaction.user.count()) > 0) throw new ConflictException('The application is already initialized.');
      return transaction.user.create({
        data: {
          firstName: input.firstName?.trim() || null,
          lastName: input.lastName?.trim() || null,
          passwordHash,
          role: 'SYSTEM_ADMIN',
          username: input.username.trim(),
        },
      });
    });
    const authenticatedUser = this.toAuthenticatedUser({ ...user, avatar: null });
    return { accessToken: await this.createAccessToken(authenticatedUser, user.authVersion), user: authenticatedUser };
  }

  /**
   * Replace the current password, invalidate other tokens, and issue a replacement token.
   *
   * @param userId - Local user identifier targeted by the operation.
   * @param currentPassword - Existing plaintext password used to authorize the credential change.
   * @param newPassword - Replacement plaintext password to hash and persist.
   * @returns The updated user identity and replacement access token.
   * @throws UnauthorizedException - Invalid credentials.
   */
  async updatePassword(userId: string, currentPassword: string, newPassword: string): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.authProvider === 'OIDC') throw new ForbiddenException('OIDC-managed users do not have a local password.');
    if (!user?.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash)))
      throw new UnauthorizedException('Invalid credentials.');
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { authVersion: { increment: 1 }, passwordHash: await bcrypt.hash(newPassword, 12) },
      include: { avatar: avatarMetadata },
    });
    const authenticatedUser = this.toAuthenticatedUser(updatedUser);
    return {
      accessToken: await this.createAccessToken(authenticatedUser, updatedUser.authVersion),
      user: authenticatedUser,
    };
  }

  /**
   * Update one user's personal identity while protecting changes to their login name.
   *
   * @param userId - Local user identifier targeted by the operation.
   * @param input - Profile values and the current password required when changing the login name.
   * @returns The updated safe user identity.
   * @throws UnauthorizedException - When the user no longer exists or a username change lacks valid credentials.
   */
  async updateProfile(userId: string, input: UpdateProfileInput): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (user.authProvider === 'OIDC') throw new ForbiddenException('OIDC-managed profile fields cannot be changed.');

    const username = input.username.trim();
    if (username !== user.username) {
      if (
        !input.currentPassword ||
        !user.passwordHash ||
        !(await bcrypt.compare(input.currentPassword, user.passwordHash))
      )
        throw new UnauthorizedException('Invalid credentials.');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: input.firstName?.trim() || null,
        lastName: input.lastName?.trim() || null,
        username,
      },
      include: { avatar: avatarMetadata },
    });
    return this.toAuthenticatedUser(updatedUser);
  }

  /**
   * Validate a bearer token supplied during a non-HTTP transport handshake.
   *
   * @param accessToken - Encoded ezRepo access token.
   * @returns The current persisted user represented by the token.
   * @throws UnauthorizedException - When the bearer token is invalid, expired, or no longer matches the persisted user
   * authentication version.
   */
  async authenticateAccessToken(accessToken: string): Promise<AuthenticatedUser> {
    try {
      const payload = await this.jwt.verifyAsync<{ authVersion?: number; sub: string }>(accessToken, {
        issuer: ENV.AUTH_JWT_ISSUER,
      });
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: { avatar: avatarMetadata },
      });
      if (!user || (payload.authVersion ?? 0) !== user.authVersion) throw new UnauthorizedException();
      return this.toAuthenticatedUser(user);
    } catch {
      throw new UnauthorizedException();
    }
  }

  /**
   * Create a normal bearer session for an already verified persisted identity.
   *
   * @param userId - Persisted user identifier.
   * @returns The existing bearer authentication contract.
   * @throws UnauthorizedException - When the verified user no longer exists.
   */
  async createSession(userId: string): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { avatar: avatarMetadata },
    });
    if (!user) throw new UnauthorizedException();
    const authenticatedUser = this.toAuthenticatedUser(user);
    return { accessToken: await this.createAccessToken(authenticatedUser, user.authVersion), user: authenticatedUser };
  }

  /**
   * Sign an access token bound to the user and current authentication version.
   *
   * @param user - Safe user identity whose ID, role, and username are included in the signed claims.
   * @param authVersion - Persisted authentication version used to invalidate older tokens.
   * @returns The signed bearer token.
   */
  private createAccessToken(user: AuthenticatedUser, authVersion: number): Promise<string> {
    return this.jwt.signAsync({ authVersion, sub: user.id, role: user.role, username: user.username });
  }

  /**
   * Project persisted user data into the safe authenticated identity.
   *
   * @param user - Persisted user fields to project without credentials.
   * @returns The safe application identity without password or token secrets.
   */
  private toAuthenticatedUser(user: {
    authProvider: AuthenticatedUser['authProvider'];
    avatar: { updatedAt: Date } | null;
    firstName: string | null;
    id: string;
    lastName: string | null;
    role: AuthenticatedUser['role'];
    username: string;
  }): AuthenticatedUser {
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
