import type { AuthenticatedUser } from '../auth/types.js';
import { ProviderOAuthService, type ProviderOAuthConfiguration } from './provider-oauth.service.js';

describe('ProviderOAuthService', () => {
  const accounts = {
    assertAdmin: jest.fn(),
    createFromOAuth: jest.fn(),
  };
  const states = {
    consume: jest.fn(),
    create: jest.fn().mockReturnValue('protected-state'),
  };
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
  };
  const fetch = jest.fn();
  const service = new ProviderOAuthService(accounts as never, fetch as never, prisma as never, states as never);
  const admin: AuthenticatedUser = {
    authProvider: 'LOCAL' as const,
    id: 'admin-id',
    role: 'SYSTEM_ADMIN',
    username: 'admin',
  };
  const configuration = service as unknown as {
    getConfiguration: (providerType: 'GITHUB') => ProviderOAuthConfiguration;
  };

  beforeEach(() => jest.clearAllMocks());

  it('builds an authorization URL with protected administrator context', () => {
    jest.spyOn(configuration, 'getConfiguration').mockReturnValue({
      authorizationUrl: 'https://provider.example.test/oauth/authorize',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scopes: 'read',
      tokenUrl: 'https://provider.example.test/oauth/token',
    });

    const result = service.start(admin, {
      baseUrl: 'https://github.example.test',
      displayName: 'Provider',
      providerType: 'GITHUB',
    });

    expect(accounts.assertAdmin).toHaveBeenCalledWith(admin);
    expect(states.create).toHaveBeenCalledWith({
      baseUrl: 'https://github.example.test',
      displayName: 'Provider',
      providerType: 'GITHUB',
      userId: 'admin-id',
    });
    expect(result.authorizationUrl).toContain('state=protected-state');
    expect(result.authorizationUrl).toContain('client_id=client-id');
  });

  it('encrypts only the OAuth access token returned by the provider', async () => {
    jest.spyOn(configuration, 'getConfiguration').mockReturnValue({
      accountBaseUrl: 'https://provider.example.test',
      authorizationUrl: 'https://provider.example.test/oauth/authorize',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scopes: 'read',
      tokenUrl: 'https://provider.example.test/oauth/token',
    });
    states.consume.mockReturnValue({
      baseUrl: 'https://github.example.test',
      displayName: 'Provider',
      providerType: 'GITHUB',
      userId: 'admin-id',
    });
    prisma.user.findUnique.mockResolvedValue(admin);
    fetch.mockResolvedValue({ json: jest.fn().mockResolvedValue({ access_token: 'oauth-access-token' }), ok: true });

    await service.complete('protected-state', 'authorization-code');

    expect(fetch).toHaveBeenCalledWith(
      'https://provider.example.test/oauth/token',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(accounts.createFromOAuth).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        accessToken: 'oauth-access-token',
        baseUrl: 'https://github.example.test',
        displayName: 'Provider',
        providerType: 'GITHUB',
      }),
    );
  });
});
