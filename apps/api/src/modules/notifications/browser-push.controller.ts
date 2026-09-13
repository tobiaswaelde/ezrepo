import { Body, Controller, Delete, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Authenticated } from '../auth/authenticated.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { BrowserPushService } from './browser-push.service.js';
import {
  BrowserPushStatusDto,
  RegisterBrowserPushSubscriptionDto,
  RemoveBrowserPushSubscriptionDto,
} from './dto/browser-push.dto.js';

interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

/** Manages native browser-push enrollment for the authenticated user. */
@ApiTags('notifications')
@Authenticated()
@Controller('browser-push')
export class BrowserPushController {
  constructor(private readonly browserPush: BrowserPushService) {}

  @Get()
  @ApiOperation({ summary: 'Get browser-push availability and enrollment status' })
  @ApiOkResponse({ type: BrowserPushStatusDto })
  async status(@Req() request: AuthenticatedRequest): Promise<BrowserPushStatusDto> {
    return this.browserPush.status(request.user.id);
  }

  @Post('subscriptions')
  @HttpCode(204)
  @ApiNoContentResponse()
  async register(
    @Req() request: AuthenticatedRequest,
    @Body() input: RegisterBrowserPushSubscriptionDto,
  ): Promise<void> {
    await this.browserPush.register(request.user.id, input);
  }

  @Delete('subscriptions')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(@Req() request: AuthenticatedRequest, @Body() input: RemoveBrowserPushSubscriptionDto): Promise<void> {
    await this.browserPush.remove(request.user.id, input.endpoint);
  }
}
