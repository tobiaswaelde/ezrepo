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
  /**
   * Initialize BrowserPushController with its required dependencies.
   *
   * @param browserPush - Service managing browser push subscriptions and delivery.
   */
  constructor(private readonly browserPush: BrowserPushService) {}

  /**
   * Return browser push availability, the public VAPID key, and the current user subscription count.
   *
   * @param request - Incoming request with the authentication or webhook context required by this endpoint.
   * @returns Push availability, the non-secret public key, and the user subscription count.
   */
  @Get()
  @ApiOperation({ summary: 'Get browser-push availability and enrollment status' })
  @ApiOkResponse({ type: BrowserPushStatusDto })
  async status(@Req() request: AuthenticatedRequest): Promise<BrowserPushStatusDto> {
    return this.browserPush.status(request.user.id);
  }

  /**
   * Register an encrypted browser push subscription for the authenticated user.
   *
   * @param request - Incoming request with the authentication or webhook context required by this endpoint.
   * @param input - Push endpoint and browser-generated authentication and encryption keys.
   * @returns A promise that resolves when the operation completes.
   * @throws BadRequestException - Browser push subscription keys are required.
   * @throws ForbiddenException - Browser push subscription belongs to another user.
   * @throws ServiceUnavailableException - Browser push is not configured.
   */
  @Post('subscriptions')
  @HttpCode(204)
  @ApiNoContentResponse()
  async register(
    @Req() request: AuthenticatedRequest,
    @Body() input: RegisterBrowserPushSubscriptionDto,
  ): Promise<void> {
    await this.browserPush.register(request.user.id, input);
  }

  /**
   * Remove a browser subscription belonging to the authenticated user.
   *
   * @param request - Incoming request with the authentication or webhook context required by this endpoint.
   * @param input - Push endpoint owned by the current user to remove.
   * @returns A promise that resolves when the operation completes.
   */
  @Delete('subscriptions')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(@Req() request: AuthenticatedRequest, @Body() input: RemoveBrowserPushSubscriptionDto): Promise<void> {
    await this.browserPush.remove(request.user.id, input.endpoint);
  }
}
