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
  @Post('github/:providerAccountId')
  @HttpCode(202)
  @Version(['1', VERSION_NEUTRAL])
  @ApiOperation({ summary: 'Accept a signed GitHub webhook delivery' })
  @ApiParam({ name: 'providerAccountId', format: 'uuid' })
  @ApiAcceptedResponse({ description: 'The delivery was accepted for asynchronous synchronization.' })
  github(
    @Param('providerAccountId') providerAccountId: string,
    @Req() request: RawBodyRequest,
  ): Promise<WebhookAcceptance> {
    return this.receive('GITHUB', providerAccountId, request);
  }

  /** Accept a signed GitLab webhook delivery. */
  @Post('gitlab/:providerAccountId')
  @HttpCode(202)
  @Version(['1', VERSION_NEUTRAL])
  @ApiOperation({ summary: 'Accept a signed GitLab webhook delivery' })
  @ApiParam({ name: 'providerAccountId', format: 'uuid' })
  @ApiAcceptedResponse({ description: 'The delivery was accepted for asynchronous synchronization.' })
  gitlab(
    @Param('providerAccountId') providerAccountId: string,
    @Req() request: RawBodyRequest,
  ): Promise<WebhookAcceptance> {
    return this.receive('GITLAB', providerAccountId, request);
  }

  /** Accept a signed Forgejo webhook delivery. */
  @Post('forgejo/:providerAccountId')
  @HttpCode(202)
  @Version(['1', VERSION_NEUTRAL])
  @ApiOperation({ summary: 'Accept a signed Forgejo webhook delivery' })
  @ApiParam({ name: 'providerAccountId', format: 'uuid' })
  @ApiAcceptedResponse({ description: 'The delivery was accepted for asynchronous synchronization.' })
  forgejo(
    @Param('providerAccountId') providerAccountId: string,
    @Req() request: RawBodyRequest,
  ): Promise<WebhookAcceptance> {
    return this.receive('FORGEJO', providerAccountId, request);
  }

  /** Accept a signed Gitea webhook delivery. */
  @Post('gitea/:providerAccountId')
  @HttpCode(202)
  @Version(['1', VERSION_NEUTRAL])
  @ApiOperation({ summary: 'Accept a signed Gitea webhook delivery' })
  @ApiParam({ name: 'providerAccountId', format: 'uuid' })
  @ApiAcceptedResponse({ description: 'The delivery was accepted for asynchronous synchronization.' })
  gitea(
    @Param('providerAccountId') providerAccountId: string,
    @Req() request: RawBodyRequest,
  ): Promise<WebhookAcceptance> {
    return this.receive('GITEA', providerAccountId, request);
  }

  private receive(
    providerType: ProviderType,
    providerAccountId: string,
    request: RawBodyRequest,
  ): Promise<WebhookAcceptance> {
    if (!request.rawBody) throw new BadRequestException('The webhook request body is required.');
    return this.webhooks.receive(providerType, providerAccountId, {
      headers: request.headers,
      payload: request.rawBody,
    });
  }
}
