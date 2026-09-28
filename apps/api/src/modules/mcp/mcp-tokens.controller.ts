import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

import { Authenticated } from '../auth/authenticated.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { CreatedMcpAccessTokenDto, CreateMcpAccessTokenDto, McpAccessTokenDto } from './dto/mcp-access-token.dto.js';
import { McpTokenService } from './mcp-token.service.js';

class ListMcpAccessTokensQueryDto {
  @IsOptional()
  @IsUUID()
  userId?: string;
}

/** Provides self-service MCP token management and administrator revocation. */
@ApiTags('mcp-tokens')
@Authenticated()
@Controller('mcp-tokens')
export class McpTokensController {
  /**
   * Initialize McpTokensController with its required dependencies.
   *
   * @param tokens - Service managing and authenticating MCP access tokens.
   */
  constructor(private readonly tokens: McpTokenService) {}

  /**
   * List safe MCP token metadata for the current user or an administrator-selected owner.
   *
   * @param request - HTTP request carrying the authenticated application user.
   * @param query - Optional token owner selected by an administrator.
   * @returns Safe token metadata without bearer values or token hashes.
   * @throws ForbiddenException - When the requester neither owns the token nor has the system administrator role.
   */
  @Get()
  @ApiOperation({ summary: 'List safe MCP token metadata' })
  @ApiOkResponse({ type: McpAccessTokenDto, isArray: true })
  list(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: ListMcpAccessTokensQueryDto,
  ): Promise<McpAccessTokenDto[]> {
    return this.tokens.list(request.user, query.userId);
  }

  /**
   * Create an MCP token owned by the authenticated caller and reveal its plaintext once.
   *
   * @param request - HTTP request carrying the authenticated application user.
   * @param body - Token label and optional expiration timestamp.
   * @returns The new token and safe metadata; the plaintext is returned only at creation.
   * @throws BadRequestException - Token expiration must be in the future.
   */
  @Post()
  @ApiOperation({ summary: 'Create a user-owned MCP token' })
  @ApiCreatedResponse({ type: CreatedMcpAccessTokenDto })
  create(
    @Req() request: { user: AuthenticatedUser },
    @Body() body: CreateMcpAccessTokenDto,
  ): Promise<CreatedMcpAccessTokenDto> {
    return this.tokens.create(request.user, body);
  }

  /**
   * Revoke an MCP token after checking ownership or administrator access.
   *
   * @param request - HTTP request carrying the authenticated application user.
   * @param id - Local identifier of the target record.
   * @returns A promise that resolves when the operation completes.
   * @throws ForbiddenException - When the requester neither owns the token nor has the system administrator role.
   */
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke an MCP token' })
  async revoke(@Req() request: { user: AuthenticatedUser }, @Param('id') id: string): Promise<void> {
    await this.tokens.revoke(request.user, id);
  }
}
