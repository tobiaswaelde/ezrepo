import type { Response } from 'express';

import type { AuthenticatedUser } from '../auth/types.js';
import type { McpHttpService } from './mcp-http.service.js';
import type { McpTokenService } from './mcp-token.service.js';
import { McpController } from './mcp.controller.js';

const user: AuthenticatedUser = { authProvider: 'LOCAL' as const, id: 'user-id', role: 'VIEWER', username: 'viewer' };

describe('McpController', () => {
  const nodeHandler = jest.fn();
  const authenticate = jest.fn();
  const controller = new McpController(
    { nodeHandler } as unknown as McpHttpService,
    { authenticate } as unknown as McpTokenService,
  );

  beforeEach(() => jest.clearAllMocks());

  function response(): Response {
    const result = {
      headersSent: false,
      json: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn(),
    };
    result.status.mockReturnValue(result);
    return result as unknown as Response;
  }

  it('rejects credentials supplied through a query string', async () => {
    const res = response();
    await controller.handle({ body: {}, headers: {}, originalUrl: '/mcp?token=secret' } as never, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('returns a bearer challenge for missing or invalid authorization', async () => {
    const res = response();
    await controller.handle({ body: {}, headers: {}, originalUrl: '/mcp' } as never, res);
    expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer');
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects an untrusted Origin before authenticating the bearer token', async () => {
    const res = response();
    await controller.handle(
      {
        body: {},
        headers: { authorization: 'Bearer ezrepo_mcp_secret', origin: 'https://untrusted.example' },
        originalUrl: '/mcp',
      } as never,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('passes validated token and current user context to the MCP handler', async () => {
    authenticate.mockResolvedValue({ expiresAt: null, record: { id: 'token-id' }, user });
    const request = {
      body: { jsonrpc: '2.0' },
      headers: { authorization: 'Bearer ezrepo_mcp_secret' },
      originalUrl: '/mcp',
    } as never;
    const res = response();

    await controller.handle(request, res);

    expect(nodeHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({ clientId: 'token-id', extra: { user }, scopes: ['ezrepo:read'] }),
      }),
      res,
      { jsonrpc: '2.0' },
    );
  });
});
