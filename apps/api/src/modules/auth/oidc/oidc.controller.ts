import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { ENV } from '../../../config/env.js';
import { Authenticated } from '../authenticated.decorator.js';
import { OidcCheckDto, OidcConfigDto, OidcExchangeDto, OidcStatusDto, UpdateOidcConfigDto } from '../dto/oidc.dto.js';
import type { AuthenticatedUser } from '../types.js';
import { OidcService, type OidcExchangeResult } from './oidc.service.js';

const bindingCookie = 'ezrepo_oidc_binding';
const callbackPath = '/api/v1/auth/oidc';

/** Exposes public OIDC protocol routes and administrator-only provider configuration. */
@ApiTags('auth')
@Controller('auth/oidc')
export class OidcController {
  /**
   * Create the public and administrator OIDC route controller.
   *
   * @param oidc - OIDC protocol and configuration service.
   */
  constructor(private readonly oidc: OidcService) {}

  /**
   * Return whether OIDC sign-in is currently usable.
   *
   * @returns Public effective OIDC availability.
   */
  @Get('status')
  status(): Promise<OidcStatusDto> {
    return this.oidc.status();
  }

  /**
   * Start an OIDC authorization redirect.
   *
   * @param request - Browser request carrying the optional binding cookie.
   * @param response - Browser response used for the cookie and redirect.
   * @param returnTo - Optional internal post-login path.
   * @returns Nothing after sending the redirect.
   * @throws HttpException - When the browser has too many pending login transactions.
   */
  @Get('start')
  async start(
    @Req() request: Request,
    @Res() response: Response,
    @Query('return_to') returnTo?: string,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const result = await this.oidc.begin(this.readCookie(request, bindingCookie), returnTo);
      if (result.bindingIsNew) {
        response.cookie(bindingCookie, result.bindingValue, {
          httpOnly: true,
          maxAge: 24 * 60 * 60 * 1000,
          path: callbackPath,
          sameSite: 'lax',
          secure: ENV.OIDC_CALLBACK_URL.startsWith('https://'),
        });
      }
      response.redirect(302, result.redirectUrl);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 429) throw error;
      response.redirect(302, this.webCallback('error', 'oidc_unavailable'));
    }
  }

  /**
   * Complete the provider callback and redirect to the web handoff page.
   *
   * @param request - Provider callback request.
   * @param response - Browser response used for the safe web redirect.
   * @returns Nothing after sending the redirect.
   */
  @Get('callback')
  async callback(@Req() request: Request, @Res() response: Response): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    const url = new URL(request.originalUrl, ENV.OIDC_CALLBACK_URL);
    for (const key of ['code', 'state', 'error', 'error_description', 'iss']) {
      if (url.searchParams.getAll(key).length > 1) {
        response.redirect(302, this.webCallback('error', 'oidc_invalid_request'));
        return;
      }
    }
    if (url.search.length > 8_192 || (url.searchParams.get('code')?.length ?? 0) > 4_096) {
      response.redirect(302, this.webCallback('error', 'oidc_invalid_request'));
      return;
    }
    try {
      const result = await this.oidc.callback(url.searchParams, this.readCookie(request, bindingCookie));
      response.redirect(302, this.webCallback(result.code ? 'code' : 'error', result.code ?? result.error!));
    } catch {
      response.redirect(302, this.webCallback('error', 'oidc_unavailable'));
    }
  }

  /**
   * Exchange the URL-fragment handoff code for the normal ezRepo bearer session.
   *
   * @param input - Validated one-time exchange code.
   * @returns The normal authentication result and internal return path.
   */
  @Post('exchange')
  @HttpCode(200)
  exchange(@Body() input: OidcExchangeDto): Promise<OidcExchangeResult> {
    return this.oidc.exchange(input.code);
  }

  /**
   * Return administrator-safe OIDC settings.
   *
   * @param request - Authenticated administrator request.
   * @returns The secret-free OIDC configuration.
   */
  @Get('config')
  @Authenticated()
  config(@Req() request: { user: AuthenticatedUser }): Promise<OidcConfigDto> {
    this.assertAdministrator(request.user);
    return this.oidc.config();
  }

  /**
   * Replace selected OIDC settings without exposing stored secrets.
   *
   * @param request - Authenticated administrator request.
   * @param input - Validated configuration changes.
   * @returns The updated secret-free OIDC configuration.
   */
  @Put('config')
  @Authenticated()
  updateConfig(
    @Req() request: { user: AuthenticatedUser },
    @Body() input: UpdateOidcConfigDto,
  ): Promise<OidcConfigDto> {
    this.assertAdministrator(request.user);
    return this.oidc.updateConfig(input);
  }

  /**
   * Check discovery and compatibility for the saved OIDC configuration.
   *
   * @param request - Authenticated administrator request.
   * @returns Safe discovery compatibility details.
   */
  @Post('check')
  @HttpCode(200)
  @Authenticated()
  check(@Req() request: { user: AuthenticatedUser }): Promise<OidcCheckDto> {
    this.assertAdministrator(request.user);
    return this.oidc.check();
  }

  /**
   * Require the system-administrator role for configuration routes.
   *
   * @param user - Current authenticated user.
   * @returns Nothing when authorization succeeds.
   * @throws ForbiddenException - When the user is not a system administrator.
   */
  private assertAdministrator(user: AuthenticatedUser): void {
    if (user.role !== 'SYSTEM_ADMIN') throw new ForbiddenException('System administrator access is required.');
  }

  /**
   * Read one encoded cookie without adding a general cookie parser dependency.
   *
   * @param request - Incoming browser request.
   * @param name - Exact cookie name.
   * @returns The decoded cookie value when present.
   */
  private readCookie(request: Request, name: string): string | undefined {
    const pair = request.headers.cookie
      ?.split(';')
      .map((value) => value.trim().split('='))
      .find(([key]) => key === name);
    return pair?.[1] ? decodeURIComponent(pair[1]) : undefined;
  }

  /**
   * Build the public web callback with sensitive handoff data in the fragment.
   *
   * @param kind - Fragment result type.
   * @param value - Opaque code or stable error code.
   * @returns The web callback URL.
   */
  private webCallback(kind: 'code' | 'error', value: string): string {
    const destination = new URL('/auth/oidc/callback', ENV.PUBLIC_URL);
    destination.hash = `${kind}=${encodeURIComponent(value)}`;
    return destination.toString();
  }
}
