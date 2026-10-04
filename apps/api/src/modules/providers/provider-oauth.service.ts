import { BadGatewayException, BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';

import { ENV } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/types.js';
import type { ProviderOAuthAuthorizationDto, StartProviderOAuthDto } from './dto/provider-oauth.dto.js';
import { ProviderAccountsService } from './provider-accounts.service.js';
import { PROVIDER_FETCH } from './provider-adapter.js';
import { ProviderOAuthStateService } from './provider-oauth-state.service.js';

type ProviderType = StartProviderOAuthDto['providerType'];
type ProviderFetch = typeof fetch;

/** Provider-specific OAuth endpoints and confidential client configuration. */
export interface ProviderOAuthConfiguration {
  accountBaseUrl?: string;
  authorizationUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  tokenUrl: string;
}

interface OAuthTokenResponse {
  access_token?: unknown;
}

/** Coordinates browser-based provider authorization without exposing OAuth client secrets. */
@Injectable()
export class ProviderOAuthService {
  /**
   * Initialize ProviderOAuthService with its required dependencies.
   *
   * @param accounts - Service managing local provider accounts and repository discovery.
   * @param fetch - Fetch implementation used for provider OAuth requests.
   * @param prisma - Database client used for persisted application state.
   * @param states - Service encrypting and validating short-lived OAuth authorization context.
   */
  constructor(
    private readonly accounts: ProviderAccountsService,
    @Inject(PROVIDER_FETCH) private readonly fetch: ProviderFetch,
    private readonly prisma: PrismaService,
    private readonly states: ProviderOAuthStateService,
  ) {}

  /**
   * Builds an authorization URL for a system administrator.
   *
   * @param user - The signed-in administrator starting the authorization.
   * @param input - Provider account metadata.
   * @returns The provider authorization URL.
   * @throws ForbiddenException - System administrator access is required.
   * @throws BadRequestException - OAuth is not configured for this provider.
   */
  start(user: AuthenticatedUser, input: StartProviderOAuthDto): ProviderOAuthAuthorizationDto {
    this.accounts.assertAdmin(user);

    const configuration = this.getConfiguration(input.providerType);
    const state = this.states.create({
      baseUrl: input.baseUrl,
      displayName: input.displayName,
      providerType: input.providerType,
      userId: user.id,
    });
    const authorizationUrl = new URL(configuration.authorizationUrl);
    authorizationUrl.search = new URLSearchParams({
      client_id: configuration.clientId,
      redirect_uri: ENV.OAUTH_CALLBACK_URL,
      response_type: 'code',
      scope: configuration.scopes,
      state,
    }).toString();

    return { authorizationUrl: authorizationUrl.toString() };
  }

  /**
   * Returns providers whose OAuth client credentials are configured in this installation.
   *
   * @returns The supported providers with complete OAuth configuration.
   */
  availableProviderTypes(): ProviderType[] {
    return (['GITHUB', 'GITLAB', 'FORGEJO'] as const).filter((providerType) => {
      const configuration = getProviderOAuthConfiguration(providerType);
      return Boolean(configuration.clientId && configuration.clientSecret);
    });
  }

  /**
   * Exchanges a provider authorization code and creates the encrypted account record.
   *
   * @param stateValue - The protected state value returned by the provider.
   * @param code - The one-time provider authorization code.
   * @returns A promise that resolves when the operation completes.
   * @throws BadGatewayException - When the provider rejects the code or returns no token.
   * @throws ForbiddenException - When the initiating user no longer exists or no longer has the system administrator
   * role.
   * @throws BadRequestException - When the state is malformed, modified, or expired.
   * @throws Error - When the encrypted envelope is malformed or fails authentication with the configured key.
   * @throws ProviderRequestError - When a provider read fails, including rate limiting; status and retry metadata are
   * preserved.
   * @throws TypeError - When the provider request fails at the network layer.
   */
  async complete(stateValue: string, code: string): Promise<void> {
    const state = this.states.consume(stateValue);
    const user = await this.prisma.user.findUnique({
      where: { id: state.userId },
      select: { authProvider: true, id: true, role: true, username: true },
    });

    if (!user || user.role !== 'SYSTEM_ADMIN') {
      throw new ForbiddenException('The administrator that started this OAuth authorization is no longer available.');
    }

    const configuration = this.getConfiguration(state.providerType);
    const response = await this.fetch(configuration.tokenUrl, {
      body: new URLSearchParams({
        client_id: configuration.clientId,
        client_secret: configuration.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: ENV.OAUTH_CALLBACK_URL,
      }).toString(),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });

    if (!response.ok) {
      throw new BadGatewayException('The provider rejected the OAuth authorization.');
    }

    const token = (await response.json()) as OAuthTokenResponse;
    if (typeof token.access_token !== 'string' || !token.access_token) {
      throw new BadGatewayException('The provider did not return an access token.');
    }

    await this.accounts.createFromOAuth(user, {
      accessToken: token.access_token,
      baseUrl: state.baseUrl ?? configuration.accountBaseUrl,
      displayName: state.displayName,
      providerType: state.providerType,
    });
  }

  /**
   * Resolve the configured OAuth endpoints and client credentials for a provider.
   *
   * @param providerType - Provider implementation selected for the operation.
   * @returns Configured OAuth endpoints, scopes, and client credentials.
   * @throws BadRequestException - OAuth is not configured for this provider.
   */
  private getConfiguration(providerType: ProviderType): ProviderOAuthConfiguration {
    const configuration = getProviderOAuthConfiguration(providerType);
    if (!configuration.clientId || !configuration.clientSecret) {
      throw new BadRequestException('OAuth is not configured for this provider.');
    }

    return configuration;
  }
}

/**
 * Build OAuth endpoints and scopes from the configured provider instance.
 *
 * @param providerType - Provider implementation selected for the operation.
 * @returns Provider-specific OAuth endpoints, scopes, and client credentials.
 */
function getProviderOAuthConfiguration(providerType: ProviderType): ProviderOAuthConfiguration {
  switch (providerType) {
    case 'GITHUB':
      return {
        authorizationUrl: 'https://github.com/login/oauth/authorize',
        clientId: ENV.GITHUB_OAUTH_CLIENT_ID,
        clientSecret: ENV.GITHUB_OAUTH_CLIENT_SECRET,
        scopes: 'repo security_events',
        tokenUrl: 'https://github.com/login/oauth/access_token',
      };
    case 'GITLAB': {
      const baseUrl = withoutTrailingSlash(ENV.GITLAB_OAUTH_BASE_URL);
      return {
        accountBaseUrl: baseUrl,
        authorizationUrl: `${baseUrl}/oauth/authorize`,
        clientId: ENV.GITLAB_OAUTH_CLIENT_ID,
        clientSecret: ENV.GITLAB_OAUTH_CLIENT_SECRET,
        scopes: 'read_api read_user',
        tokenUrl: `${baseUrl}/oauth/token`,
      };
    }
    case 'FORGEJO': {
      const baseUrl = withoutTrailingSlash(ENV.FORGEJO_OAUTH_BASE_URL);
      return {
        accountBaseUrl: baseUrl,
        authorizationUrl: `${baseUrl}/login/oauth/authorize`,
        clientId: ENV.FORGEJO_OAUTH_CLIENT_ID,
        clientSecret: ENV.FORGEJO_OAUTH_CLIENT_SECRET,
        scopes: 'read:repository',
        tokenUrl: `${baseUrl}/login/oauth/access_token`,
      };
    }
  }
}

/**
 * Remove the final slash from a provider base URL.
 *
 * @param value - Value to parse, validate, or normalize.
 * @returns The URL with one trailing slash removed.
 */
function withoutTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}
