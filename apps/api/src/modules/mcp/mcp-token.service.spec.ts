import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';

import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { McpTokenService } from './mcp-token.service.js';

const viewer: AuthenticatedUser = { authProvider: 'LOCAL' as const, id: 'user-id', role: 'VIEWER', username: 'viewer' };
const admin: AuthenticatedUser = {
  authProvider: 'LOCAL' as const,
  id: 'admin-id',
  role: 'SYSTEM_ADMIN',
  username: 'admin',
};
const persistedToken = {
  createdAt: new Date('2026-09-12T10:00:00.000Z'),
  expiresAt: null,
  id: 'token-id',
  lastUsedAt: null,
  name: 'Editor',
  revokedAt: null,
  tokenHash: 'hash',
  tokenPrefix: 'ezrepo_mcp_prefix',
  updatedAt: new Date('2026-09-12T10:00:00.000Z'),
  userId: viewer.id,
};

describe('McpTokenService', () => {
  const mcpAccessToken = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const service = new McpTokenService({ mcpAccessToken } as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('creates a 256-bit user-owned token while persisting only its hash and prefix', async () => {
    mcpAccessToken.create.mockImplementation(({ data }) => ({ ...persistedToken, ...data }));

    const created = await service.create(viewer, { name: 'Editor' });

    expect(created.token).toMatch(/^ezrepo_mcp_[A-Za-z0-9_-]{43}$/);
    expect(created.tokenPrefix).toBe(created.token.slice(0, 20));
    expect(mcpAccessToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        expiresAt: null,
        name: 'Editor',
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        userId: viewer.id,
      }),
    });
    expect(mcpAccessToken.create.mock.calls[0][0].data.tokenHash).not.toContain(created.token);
  });

  it('rejects an expiration that is not in the future', async () => {
    await expect(service.create(viewer, { expiresAt: '2020-01-01T00:00:00.000Z', name: 'Expired' })).rejects.toThrow(
      BadRequestException,
    );
    expect(mcpAccessToken.create).not.toHaveBeenCalled();
  });

  it('authenticates an active token and returns the current persisted user', async () => {
    const user = { ...viewer, createdAt: new Date(), updatedAt: new Date(), passwordHash: 'hidden' };
    mcpAccessToken.findUnique.mockResolvedValue({ ...persistedToken, user });
    mcpAccessToken.update.mockResolvedValue({ ...persistedToken, lastUsedAt: new Date() });

    await expect(service.authenticate('ezrepo_mcp_valid')).resolves.toEqual(
      expect.objectContaining({ user: viewer, record: expect.not.objectContaining({ user: expect.anything() }) }),
    );
    expect(mcpAccessToken.update).toHaveBeenCalledWith({
      data: { lastUsedAt: expect.any(Date) },
      where: { id: persistedToken.id },
    });
  });

  it.each([{ revokedAt: new Date() }, { expiresAt: new Date('2020-01-01T00:00:00.000Z') }])(
    'rejects inactive tokens',
    async (state) => {
      mcpAccessToken.findUnique.mockResolvedValue({ ...persistedToken, ...state, user: viewer });
      await expect(service.authenticate('ezrepo_mcp_inactive')).rejects.toThrow(UnauthorizedException);
      expect(mcpAccessToken.update).not.toHaveBeenCalled();
    },
  );

  it('rejects a token after its owning user has been deleted', async () => {
    mcpAccessToken.findUnique.mockResolvedValue(null);

    await expect(service.authenticate('ezrepo_mcp_deleted_user')).rejects.toThrow(UnauthorizedException);
    expect(mcpAccessToken.update).not.toHaveBeenCalled();
  });

  it('allows administrators to inspect metadata and revoke another user token', async () => {
    mcpAccessToken.findMany.mockResolvedValue([persistedToken]);
    mcpAccessToken.findUnique.mockResolvedValue(persistedToken);
    mcpAccessToken.update.mockResolvedValue({ ...persistedToken, revokedAt: new Date() });

    await expect(service.list(admin, viewer.id)).resolves.toEqual([
      expect.not.objectContaining({ tokenHash: expect.anything() }),
    ]);
    await expect(service.revoke(admin, persistedToken.id)).resolves.toBeUndefined();
  });

  it('prevents users from inspecting another user tokens', async () => {
    await expect(service.list(viewer, 'another-user')).rejects.toThrow(ForbiddenException);
    expect(mcpAccessToken.findMany).not.toHaveBeenCalled();
  });
});
