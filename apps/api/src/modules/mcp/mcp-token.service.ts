import { createHash, randomBytes } from 'node:crypto';

import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';

import type { McpAccessToken, User } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/types.js';
import {
  CreatedMcpAccessTokenDto,
  type CreateMcpAccessTokenDto,
  McpAccessTokenDto,
} from './dto/mcp-access-token.dto.js';

const tokenPrefix = 'ezrepo_mcp_';

/** Creates, validates, and revokes user-owned MCP bearer tokens. */
@Injectable()
export class McpTokenService {
  /**
   * Initialize McpTokenService with its required dependencies.
   *
   * @param prisma - Database client used for persisted application state.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List safe token metadata owned by the caller or a user selected by an administrator.
   *
   * @param requester - Authenticated user requesting token access.
   * @param requestedUserId - Optional owner selected by an administrator; otherwise the caller is used.
   * @returns Safe token metadata without bearer values or token hashes.
   * @throws ForbiddenException - When the requester neither owns the token nor has the system administrator role.
   */
  async list(requester: AuthenticatedUser, requestedUserId?: string): Promise<McpAccessTokenDto[]> {
    const userId = requestedUserId ?? requester.id;
    this.assertOwnerOrAdmin(requester, userId);
    const tokens = await this.prisma.mcpAccessToken.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: { userId },
    });
    return tokens.map((token) => McpAccessTokenDto.fromModel(token));
  }

  /**
   * Create a high-entropy token owned by the authenticated caller and reveal it once.
   *
   * @param user - Authenticated user whose identity and permissions apply to the operation.
   * @param input - Token label and optional expiration timestamp.
   * @returns The new token and safe metadata; the plaintext is returned only at creation.
   * @throws BadRequestException - Token expiration must be in the future.
   */
  async create(user: AuthenticatedUser, input: CreateMcpAccessTokenDto): Promise<CreatedMcpAccessTokenDto> {
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) throw new BadRequestException('Token expiration must be in the future.');

    const token = `${tokenPrefix}${randomBytes(32).toString('base64url')}`;
    const persisted = await this.prisma.mcpAccessToken.create({
      data: {
        expiresAt,
        name: input.name,
        tokenHash: this.hash(token),
        tokenPrefix: token.slice(0, 20),
        userId: user.id,
      },
    });
    return { ...McpAccessTokenDto.fromModel(persisted), token };
  }

  /**
   * Revoke a token owned by the caller or selected by a system administrator.
   *
   * @param requester - Authenticated user requesting token access.
   * @param id - Local identifier of the target record.
   * @returns A promise that resolves when the operation completes.
   * @throws ForbiddenException - When the requester neither owns the token nor has the system administrator role.
   */
  async revoke(requester: AuthenticatedUser, id: string): Promise<void> {
    const token = await this.prisma.mcpAccessToken.findUnique({ where: { id } });
    if (!token) return;
    this.assertOwnerOrAdmin(requester, token.userId);
    if (!token.revokedAt) await this.prisma.mcpAccessToken.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  /**
   * Authenticate an MCP bearer token and load the current persisted user.
   *
   * @param token - Bearer token or provider credential; never included in diagnostic output.
   * @returns The valid token record, its expiry, and the current safe user identity.
   * @throws UnauthorizedException - When the bearer token is unknown, revoked, expired, or its owner is no longer
   * available.
   */
  async authenticate(
    token: string,
  ): Promise<{ expiresAt: Date | null; record: McpAccessToken; user: AuthenticatedUser }> {
    const record = await this.prisma.mcpAccessToken.findUnique({
      include: { user: true },
      where: { tokenHash: this.hash(token) },
    });
    if (
      !record ||
      !token.startsWith(tokenPrefix) ||
      record.revokedAt ||
      (record.expiresAt && record.expiresAt <= new Date())
    ) {
      throw new UnauthorizedException();
    }

    const updated = await this.prisma.mcpAccessToken.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    });
    return {
      expiresAt: record.expiresAt,
      record: updated,
      user: this.toAuthenticatedUser(record.user),
    };
  }

  /**
   * Require token ownership or system administrator access.
   *
   * @param requester - Authenticated user requesting token access.
   * @param userId - Local user identifier targeted by the operation.
   * @returns No return value.
   * @throws ForbiddenException - When the requester neither owns the token nor has the system administrator role.
   */
  private assertOwnerOrAdmin(requester: AuthenticatedUser, userId: string): void {
    if (requester.id !== userId && requester.role !== 'SYSTEM_ADMIN') throw new ForbiddenException();
  }

  /**
   * Hash an MCP bearer token with SHA-256 for lookup without storing its plaintext.
   *
   * @param token - Bearer token or provider credential; never included in diagnostic output.
   * @returns The lowercase hexadecimal SHA-256 token digest.
   */
  private hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  /**
   * Project persisted user data into the safe authenticated identity.
   *
   * @param user - Persisted user fields to project without credentials.
   * @returns The safe application identity without password or token secrets.
   */
  private toAuthenticatedUser(user: User): AuthenticatedUser {
    return { authProvider: user.authProvider, id: user.id, role: user.role, username: user.username };
  }
}
