import { toNodeHandler, type NodeMcpRequestHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/types.js';
import { McpServerFactory } from './mcp-server.factory.js';

/** Owns the stateless MCP v2 request handler shared by the Nest controller. */
@Injectable()
export class McpHttpService implements OnModuleDestroy {
  private readonly logger = new Logger(McpHttpService.name);
  private readonly handler;
  readonly nodeHandler: NodeMcpRequestHandler;

  /**
   * Initialize McpHttpService with its required dependencies.
   *
   * @param factory - Factory creating an MCP server bound to the authenticated user.
   */
  constructor(factory: McpServerFactory) {
    this.handler = createMcpHandler(({ authInfo }) => factory.create(this.getUser(authInfo)), {
      legacy: 'reject',
      onerror: (error) => this.logger.error(error.message),
    });
    this.nodeHandler = toNodeHandler(this.handler, { onerror: (error) => this.logger.error(error.message) });
  }

  /**
   * Close the shared MCP handler during application shutdown.
   *
   * @returns A promise that resolves when the operation completes.
   */
  async onModuleDestroy(): Promise<void> {
    await this.handler.close();
  }

  /**
   * Extract the authenticated user bound to the MCP request context.
   *
   * @param authInfo - Optional authentication metadata attached by the MCP HTTP endpoint.
   * @returns The authenticated user attached to the MCP context.
   * @throws Error - MCP authentication context is missing.
   */
  private getUser(authInfo?: AuthInfo): AuthenticatedUser {
    const user = authInfo?.extra?.user as AuthenticatedUser | undefined;
    if (!user) throw new Error('MCP authentication context is missing.');
    return user;
  }
}
