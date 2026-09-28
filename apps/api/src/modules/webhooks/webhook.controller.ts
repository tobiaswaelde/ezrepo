import { BadRequestException, Controller, HttpCode, Param, Post, Req, VERSION_NEUTRAL, Version } from '@nestjs/common';
import { ApiAcceptedResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import type { ProviderType } from '../../generated/prisma/client.js';
import { WebhookService, type WebhookAcceptance } from './webhook.service.js';

type RawBodyRequest = Request & { rawBody?: Buffer };

/** Accepts signed GitHub, GitLab, Forgejo, and Gitea webhook deliveries. */
@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookController {
  /**
   * Initialize WebhookController with its required dependencies.
   *
   * @param webhooks - Service verifying and durably accepting provider webhooks.
   */
  constructor(private readonly webhooks: WebhookService) {}

  /**
   * Accept a signed GitHub webhook delivery.
   *
   * @param repositoryId - Local identifier of the tracked repository.
   * @param request - Incoming request with the authentication or webhook context required by this endpoint.
   * @returns The webhook acceptance result, including duplicate and synchronization scheduling state.
   * @throws BadRequestException - The webhook request body is required.
   * @throws UnauthorizedException - When the account or signature cannot be verified.
   * @throws Error - When no adapter is registered for the requested provider type.
   */
  @Post('github/:repositoryId')
  @HttpCode(202)
  @Version(['1', VERSION_NEUTRAL])
  @ApiOperation({ summary: 'Accept a signed GitHub webhook delivery' })
  @ApiParam({ name: 'repositoryId', format: 'uuid' })
  @ApiAcceptedResponse({ description: 'The delivery was accepted for asynchronous synchronization.' })
  github(@Param('repositoryId') repositoryId: string, @Req() request: RawBodyRequest): Promise<WebhookAcceptance> {
    return this.receive('GITHUB', repositoryId, request);
  }

  /**
   * Accept a signed GitLab webhook delivery.
   *
   * @param repositoryId - Local identifier of the tracked repository.
   * @param request - Incoming request with the authentication or webhook context required by this endpoint.
   * @returns The webhook acceptance result, including duplicate and synchronization scheduling state.
   * @throws BadRequestException - The webhook request body is required.
   * @throws UnauthorizedException - When the account or signature cannot be verified.
   * @throws Error - When no adapter is registered for the requested provider type.
   */
  @Post('gitlab/:repositoryId')
  @HttpCode(202)
  @Version(['1', VERSION_NEUTRAL])
  @ApiOperation({ summary: 'Accept a signed GitLab webhook delivery' })
  @ApiParam({ name: 'repositoryId', format: 'uuid' })
  @ApiAcceptedResponse({ description: 'The delivery was accepted for asynchronous synchronization.' })
  gitlab(@Param('repositoryId') repositoryId: string, @Req() request: RawBodyRequest): Promise<WebhookAcceptance> {
    return this.receive('GITLAB', repositoryId, request);
  }

  /**
   * Accept a signed Forgejo webhook delivery.
   *
   * @param repositoryId - Local identifier of the tracked repository.
   * @param request - Incoming request with the authentication or webhook context required by this endpoint.
   * @returns The webhook acceptance result, including duplicate and synchronization scheduling state.
   * @throws BadRequestException - The webhook request body is required.
   * @throws UnauthorizedException - When the account or signature cannot be verified.
   * @throws Error - When no adapter is registered for the requested provider type.
   */
  @Post('forgejo/:repositoryId')
  @HttpCode(202)
  @Version(['1', VERSION_NEUTRAL])
  @ApiOperation({ summary: 'Accept a signed Forgejo webhook delivery' })
  @ApiParam({ name: 'repositoryId', format: 'uuid' })
  @ApiAcceptedResponse({ description: 'The delivery was accepted for asynchronous synchronization.' })
  forgejo(@Param('repositoryId') repositoryId: string, @Req() request: RawBodyRequest): Promise<WebhookAcceptance> {
    return this.receive('FORGEJO', repositoryId, request);
  }

  /**
   * Accept a signed Gitea webhook delivery.
   *
   * @param repositoryId - Local identifier of the tracked repository.
   * @param request - Incoming request with the authentication or webhook context required by this endpoint.
   * @returns The webhook acceptance result, including duplicate and synchronization scheduling state.
   * @throws BadRequestException - The webhook request body is required.
   * @throws UnauthorizedException - When the account or signature cannot be verified.
   * @throws Error - When no adapter is registered for the requested provider type.
   */
  @Post('gitea/:repositoryId')
  @HttpCode(202)
  @Version(['1', VERSION_NEUTRAL])
  @ApiOperation({ summary: 'Accept a signed Gitea webhook delivery' })
  @ApiParam({ name: 'repositoryId', format: 'uuid' })
  @ApiAcceptedResponse({ description: 'The delivery was accepted for asynchronous synchronization.' })
  gitea(@Param('repositoryId') repositoryId: string, @Req() request: RawBodyRequest): Promise<WebhookAcceptance> {
    return this.receive('GITEA', repositoryId, request);
  }

  /**
   * Require a raw webhook body and delegate signature verification and durable acceptance.
   *
   * @param providerType - Provider implementation selected for the operation.
   * @param repositoryId - Local identifier of the tracked repository.
   * @param request - Incoming request with the authentication or webhook context required by this endpoint.
   * @returns The webhook acceptance result, including duplicate and synchronization scheduling state.
   * @throws BadRequestException - The webhook request body is required.
   * @throws UnauthorizedException - When the account or signature cannot be verified.
   * @throws Error - When no adapter is registered for the requested provider type.
   */
  private receive(
    providerType: ProviderType,
    repositoryId: string,
    request: RawBodyRequest,
  ): Promise<WebhookAcceptance> {
    if (!request.rawBody) throw new BadRequestException('The webhook request body is required.');
    return this.webhooks.receive(providerType, repositoryId, {
      headers: request.headers,
      payload: request.rawBody,
    });
  }
}
