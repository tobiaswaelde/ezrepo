import { ForbiddenException } from '@nestjs/common';

import { OidcController } from './oidc.controller.js';

describe('OidcController authorization and browser handoff', () => {
  const service = {
    callback: jest.fn(),
    check: jest.fn(),
    config: jest.fn(),
    exchange: jest.fn(),
    status: jest.fn(),
    updateConfig: jest.fn(),
  };
  const controller = new OidcController(service as never);
  const administrator = {
    authProvider: 'LOCAL' as const,
    id: 'admin-id',
    role: 'SYSTEM_ADMIN' as const,
    username: 'admin',
  };
  const viewer = {
    authProvider: 'LOCAL' as const,
    id: 'viewer-id',
    role: 'VIEWER' as const,
    username: 'viewer',
  };

  beforeEach(() => jest.clearAllMocks());

  it('keeps status and exchange public while restricting configuration and checks to system administrators', async () => {
    service.status.mockResolvedValue({ enabled: false });
    service.exchange.mockResolvedValue({ accessToken: 'jwt', returnTo: '/', user: viewer });
    service.config.mockResolvedValue({ enabled: false });
    service.check.mockResolvedValue({ ok: true });

    await expect(controller.status()).resolves.toEqual({ enabled: false });
    await expect(controller.exchange({ code: 'x'.repeat(43) })).resolves.toMatchObject({ accessToken: 'jwt' });
    await expect(controller.config({ user: administrator })).resolves.toEqual({ enabled: false });
    await expect(controller.check({ user: administrator })).resolves.toEqual({ ok: true });
    expect(() => controller.config({ user: viewer })).toThrow(ForbiddenException);
    expect(() => controller.check({ user: viewer })).toThrow(ForbiddenException);
    expect(() => controller.updateConfig({ user: viewer }, {})).toThrow(ForbiddenException);
  });

  it('places only the opaque one-time code in the web URL fragment', async () => {
    service.callback.mockResolvedValue({ code: 'opaque-handoff-code' });
    const response = { redirect: jest.fn(), setHeader: jest.fn() };

    await controller.callback(
      {
        headers: { cookie: 'ezrepo_oidc_binding=binding' },
        originalUrl: '/api/v1/auth/oidc/callback?code=provider-code&state=provider-state',
      } as never,
      response as never,
    );

    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(response.redirect).toHaveBeenCalledWith(
      302,
      expect.stringMatching(/^http:\/\/localhost:3000\/auth\/oidc\/callback#code=opaque-handoff-code$/),
    );
    expect(response.redirect.mock.calls[0]?.[1]).not.toContain('jwt');
  });
});
