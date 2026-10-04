import { createMcpHandler } from '@modelcontextprotocol/server';

import type { AuthenticatedUser } from '../auth/types.js';
import { McpServerFactory } from './mcp-server.factory.js';
import type { McpToolsService } from './mcp-tools.service.js';

interface RegisteredTool {
  annotations: Record<string, boolean>;
  handler: (input: unknown) => Promise<{ structuredContent: unknown }>;
}

const user: AuthenticatedUser = { authProvider: 'LOCAL' as const, id: 'viewer-id', role: 'VIEWER', username: 'viewer' };

function listToolsRequest(id: number): Request {
  return new Request('http://localhost/mcp', {
    body: JSON.stringify({
      id,
      jsonrpc: '2.0',
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/clientCapabilities': {},
          'io.modelcontextprotocol/clientInfo': { name: 'ezrepo-test', version: '1.0.0' },
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        },
      },
    }),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'MCP-Method': 'tools/list',
      'MCP-Protocol-Version': '2026-07-28',
    },
    method: 'POST',
  });
}

describe('McpServerFactory', () => {
  const tools = {
    getDashboardSummary: jest.fn(),
    getRepository: jest.fn(),
    getWorkflowTrend: jest.fn(),
    listAwaitingApproval: jest.fn(),
    listNeedsAttention: jest.fn(),
    listRepositories: jest.fn(),
    listWorkflowRuns: jest.fn(),
  };
  const factory = new McpServerFactory(tools as unknown as McpToolsService);

  beforeEach(() => jest.clearAllMocks());

  it('advertises exactly seven read-only tools without resources or prompts', () => {
    const server = factory.create(user);
    const internal = server as unknown as {
      _registeredPrompts: Record<string, unknown>;
      _registeredResources: Record<string, unknown>;
      _registeredTools: Record<string, RegisteredTool>;
    };

    expect(Object.keys(internal._registeredTools)).toEqual([
      'list_repositories',
      'get_repository',
      'list_workflow_runs',
      'list_needs_attention',
      'list_awaiting_approval',
      'get_dashboard_summary',
      'get_workflow_trend',
    ]);
    expect(internal._registeredResources).toEqual({});
    expect(internal._registeredPrompts).toEqual({});
    for (const tool of Object.values(internal._registeredTools)) {
      expect(tool.annotations).toEqual({
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      });
    }
  });

  it('binds tool execution to the authenticated user and returns structured JSON', async () => {
    tools.getRepository.mockResolvedValue({ id: 'repository-id', lastSyncAt: new Date('2026-09-12T10:00:00Z') });
    const server = factory.create(user) as unknown as {
      _registeredTools: Record<string, RegisteredTool>;
    };

    const result = await server._registeredTools.get_repository.handler({ repositoryId: 'repository-id' });

    expect(tools.getRepository).toHaveBeenCalledWith(user, 'repository-id');
    expect(result.structuredContent).toEqual({ id: 'repository-id', lastSyncAt: '2026-09-12T10:00:00.000Z' });
  });

  it('serves the 2026-07-28 tool catalog over stateless Streamable HTTP', async () => {
    const handler = createMcpHandler(() => factory.create(user), { legacy: 'reject' });

    try {
      const response = await handler.fetch(listToolsRequest(1), {
        authInfo: { clientId: 'token-id', scopes: ['mcp:read'], token: 'redacted' },
      });
      const body = (await response.json()) as { result: { tools: Array<{ name: string }> } };

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(body.result.tools.map((tool) => tool.name)).toEqual([
        'list_repositories',
        'get_repository',
        'list_workflow_runs',
        'list_needs_attention',
        'list_awaiting_approval',
        'get_dashboard_summary',
        'get_workflow_trend',
      ]);
    } finally {
      await handler.close();
    }
  });

  it('uses a fresh server for every concurrent stateless request', async () => {
    let serverCount = 0;
    const handler = createMcpHandler(() => {
      serverCount += 1;
      return factory.create(user);
    });
    const options = { authInfo: { clientId: 'token-id', scopes: ['mcp:read'], token: 'redacted' } };

    try {
      const responses = await Promise.all([
        handler.fetch(listToolsRequest(1), options),
        handler.fetch(listToolsRequest(2), options),
      ]);

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(serverCount).toBe(2);
    } finally {
      await handler.close();
    }
  });

  it('defaults list pagination to 25 and rejects limits above 100 at the protocol boundary', async () => {
    tools.listRepositories.mockResolvedValue({ items: [], page: 1, perPage: 25, total: 0 });
    const handler = createMcpHandler(() => factory.create(user), { legacy: 'reject' });
    const request = (id: number, limit?: number) =>
      new Request('http://localhost/mcp', {
        body: JSON.stringify({
          id,
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            _meta: {
              'io.modelcontextprotocol/clientCapabilities': {},
              'io.modelcontextprotocol/clientInfo': { name: 'ezrepo-test', version: '1.0.0' },
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            },
            arguments: limit === undefined ? {} : { limit },
            name: 'list_repositories',
          },
        }),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'MCP-Method': 'tools/call',
          'MCP-Name': 'list_repositories',
          'MCP-Protocol-Version': '2026-07-28',
        },
        method: 'POST',
      });
    const options = { authInfo: { clientId: 'token-id', scopes: ['mcp:read'], token: 'redacted' } };

    try {
      const defaultResponse = await handler.fetch(request(1), options);
      const invalidResponse = await handler.fetch(request(2, 101), options);
      const invalidBody = (await invalidResponse.json()) as {
        error?: { code: number };
        result?: { isError?: boolean };
      };

      expect(defaultResponse.status).toBe(200);
      expect(tools.listRepositories).toHaveBeenCalledTimes(1);
      expect(tools.listRepositories).toHaveBeenCalledWith(user, { limit: 25, page: 1 });
      expect(invalidBody.error?.code === -32602 || invalidBody.result?.isError === true).toBe(true);
      expect(tools.listRepositories).toHaveBeenCalledTimes(1);
    } finally {
      await handler.close();
    }
  });
});
