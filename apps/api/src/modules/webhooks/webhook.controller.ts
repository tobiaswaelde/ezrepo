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
  constructor(private readonly webhooks: WebhookService) {}

  /** Accept a signed GitHub webhook delivery. */
  @Post('github/:repositoryId')
  @HttpCode(202)
  @Version(['1', VERSION_NEUTRAL])
  @ApiOperation({ summary: 'Accept a signed GitHub webhook delivery' })
  @ApiParam({ name: 'repositoryId', format: 'uuid' })
  @ApiAcceptedResponse({ description: 'The delivery was accepted for asynchronous synchronization.' })
  github(@Param('repositoryId') repositoryId: string, @Req() request: RawBodyRequest): Promise<WebhookAcceptance> {
    return this.receive('GITHUB', repositoryId, request);
  }

  /** Accept a signed GitLab webhook delivery. */
  @Post('gitlab/:repositoryId')
  @HttpCode(202)
  @Version(['1', VERSION_NEUTRAL])
  @ApiOperation({ summary: 'Accept a signed GitLab webhook delivery' })
  @ApiParam({ name: 'repositoryId', format: 'uuid' })
  @ApiAcceptedResponse({ description: 'The delivery was accepted for asynchronous synchronization.' })
  gitlab(@Param('repositoryId') repositoryId: string, @Req() request: RawBodyRequest): Promise<WebhookAcceptance> {
    return this.receive('GITLAB', repositoryId, request);
  }

  /** Accept a signed Forgejo webhook delivery. */
  @Post('forgejo/:repositoryId')
  @HttpCode(202)
  @Version(['1', VERSION_NEUTRAL])
  @ApiOperation({ summary: 'Accept a signed Forgejo webhook delivery' })
  @ApiParam({ name: 'repositoryId', format: 'uuid' })
  @ApiAcceptedResponse({ description: 'The delivery was accepted for asynchronous synchronization.' })
  forgejo(@Param('repositoryId') repositoryId: string, @Req() request: RawBodyRequest): Promise<WebhookAcceptance> {
    return this.receive('FORGEJO', repositoryId, request);
  }

  /** Accept a signed Gitea webhook delivery. */
  @Post('gitea/:repositoryId')
  @HttpCode(202)
  @Version(['1', VERSION_NEUTRAL])
  @ApiOperation({ summary: 'Accept a signed Gitea webhook delivery' })
  @ApiParam({ name: 'repositoryId', format: 'uuid' })
  @ApiAcceptedResponse({ description: 'The delivery was accepted for asynchronous synchronization.' })
  gitea(@Param('repositoryId') repositoryId: string, @Req() request: RawBodyRequest): Promise<WebhookAcceptance> {
    return this.receive('GITEA', repositoryId, request);
  }

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
