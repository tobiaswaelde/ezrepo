import { UnauthorizedException } from '@nestjs/common';

import { OidcService } from './oidc.service.js';

const config = {
  allowHttpIssuer: false,
  allowUnmatchedViewer: false,
  clientId: 'client-id',
  configRevision: 3,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  enabled: true,
  encryptedClientSecret: 'encrypted-secret',
  groupsClaim: 'groups',
  id: 'config-id',
  issuer: 'https://id.example',
  key: 'global',
  managerGroups: ['managers'],
  observedGroups: ['seen'],
  providerName: 'Company SSO',
  scopes: ['openid', 'profile'],
  systemAdministratorGroups: ['admins'],
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  viewerGroups: ['viewers'],
};

describe('OidcService', () => {
  const transaction = {
    oidcConfig: { update: jest.fn() },
    oidcLoginTransaction: { deleteMany: jest.fn() },
    oidcSessionExchange: { deleteMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    user: { updateMany: jest.fn() },
  };
  const prisma = {
    oidcConfig: { upsert: jest.fn() },
    transaction: jest.fn(),
    user: { findUnique: jest.fn(), upsert: jest.fn(), updateMany: jest.fn() },
  };
  const credentials = { decrypt: jest.fn(), encrypt: jest.fn() };
  const auth = { createSession: jest.fn() };
  const service = new OidcService(prisma as never, credentials as never, auth as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.oidcConfig.upsert.mockResolvedValue(config);
    prisma.transaction.mockImplementation((callback) => callback(transaction));
    credentials.decrypt.mockReturnValue('plain-secret');
  });

  it('never exposes the encrypted or plaintext client secret', async () => {
    await expect(service.config()).resolves.toEqual(
      expect.objectContaining({ clientSecretConfigured: true, secretDecryptable: true }),
    );
    const serialized = JSON.stringify(await service.config());
    expect(serialized).not.toContain('encrypted-secret');
    expect(serialized).not.toContain('plain-secret');
  });

  it('maps an undecryptable saved secret to a safe discovery-check code', async () => {
    credentials.decrypt.mockImplementation(() => {
      throw new Error('ciphertext details');
    });

    await expect(service.check()).resolves.toEqual({ code: 'secret_unavailable', ok: false });
  });

  it('keeps an omitted secret and does not invalidate sessions for a display-name-only change', async () => {
    transaction.oidcConfig.update.mockResolvedValue({ ...config, providerName: 'Renamed SSO' });

    await service.updateConfig({ providerName: 'Renamed SSO' });

    expect(credentials.encrypt).not.toHaveBeenCalled();
    expect(transaction.oidcConfig.update).toHaveBeenCalledWith({
      data: expect.objectContaining({ configRevision: undefined, encryptedClientSecret: 'encrypted-secret' }),
      where: { id: 'config-id' },
    });
    expect(transaction.user.updateMany).not.toHaveBeenCalled();
  });

  it('encrypts a replacement secret and invalidates OIDC transactions and bearer sessions', async () => {
    credentials.encrypt.mockReturnValue('replacement-ciphertext');
    transaction.oidcConfig.update.mockResolvedValue({
      ...config,
      configRevision: 4,
      encryptedClientSecret: 'replacement-ciphertext',
    });

    await service.updateConfig({ clientSecret: 'replacement-secret' });

    expect(credentials.encrypt).toHaveBeenCalledWith('replacement-secret');
    expect(transaction.oidcLoginTransaction.deleteMany).toHaveBeenCalled();
    expect(transaction.oidcSessionExchange.deleteMany).toHaveBeenCalled();
    expect(transaction.user.updateMany).toHaveBeenCalledWith({
      data: { authVersion: { increment: 1 } },
      where: { authProvider: 'OIDC' },
    });
  });

  it('consumes a session handoff atomically and rejects a replay', async () => {
    transaction.oidcSessionExchange.findUnique.mockResolvedValue({
      consumedAt: null,
      expiresAt: new Date(Date.now() + 30_000),
      id: 'exchange-id',
      returnTo: '/repositories',
      userId: 'user-id',
    });
    transaction.oidcSessionExchange.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    auth.createSession.mockResolvedValue({ accessToken: 'jwt', user: { id: 'user-id' } });

    await expect(service.exchange('x'.repeat(43))).resolves.toEqual({
      accessToken: 'jwt',
      returnTo: '/repositories',
      user: { id: 'user-id' },
    });
    await expect(service.exchange('x'.repeat(43))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.createSession).toHaveBeenCalledTimes(1);
  });

  it('rejects an expired handoff before issuing a bearer session', async () => {
    transaction.oidcSessionExchange.findUnique.mockResolvedValue({
      consumedAt: null,
      expiresAt: new Date(Date.now() - 1),
      id: 'exchange-id',
    });

    await expect(service.exchange('x'.repeat(43))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(transaction.oidcSessionExchange.updateMany).not.toHaveBeenCalled();
    expect(auth.createSession).not.toHaveBeenCalled();
  });

  it('provisions only by verified issuer and subject without linking mutable claims', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    prisma.user.upsert.mockResolvedValue({ id: 'oidc-user-id' });
    const provisioning = service as unknown as {
      provisionUser(
        issuer: string,
        subject: string,
        role: 'VIEWER',
        claims: Record<string, unknown>,
      ): Promise<{ id: string }>;
    };

    await expect(
      provisioning.provisionUser('https://id.example', 'stable-subject', 'VIEWER', {
        email: 'local-user@example.com',
        preferred_username: 'local-user',
      }),
    ).resolves.toEqual({ id: 'oidc-user-id' });
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      create: expect.objectContaining({
        authProvider: 'OIDC',
        oidcIssuer: 'https://id.example',
        oidcSubject: 'stable-subject',
        role: 'VIEWER',
        username: expect.stringMatching(/^oidc_[a-f0-9]+$/),
      }),
      update: expect.any(Object),
      where: {
        oidcIssuer_oidcSubject: { oidcIssuer: 'https://id.example', oidcSubject: 'stable-subject' },
      },
    });
    expect(prisma.user.upsert.mock.calls[0]?.[0].create).not.toHaveProperty('email');
  });

  it('increments the authentication version when group mappings change an existing OIDC role', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ oidcIssuer: 'https://id.example', oidcSubject: 'stable-subject' })
      .mockResolvedValueOnce({ firstName: null, lastName: null, role: 'VIEWER' });
    prisma.user.upsert.mockResolvedValue({ id: 'oidc-user-id' });
    const provisioning = service as unknown as {
      provisionUser(
        issuer: string,
        subject: string,
        role: 'MANAGER',
        claims: Record<string, unknown>,
      ): Promise<{ id: string }>;
    };

    await provisioning.provisionUser('https://id.example', 'stable-subject', 'MANAGER', {});

    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ authVersion: { increment: 1 }, role: 'MANAGER' }) }),
    );
  });
});
