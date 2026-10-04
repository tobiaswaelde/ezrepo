import * as oidc from 'openid-client';

import type { OidcCheckResult, OidcConfigRecord, OidcErrorCode } from './oidc.types.js';

const HTTP_TIMEOUT_SECONDS = 10;
const responseLimits = { discovery: 512 * 1024, jwks: 256 * 1024, token: 512 * 1024, userinfo: 1024 * 1024 };
const asymmetricAlgorithms = ['RS256', 'PS256', 'ES256', 'EdDSA', 'RS384', 'PS384', 'ES384', 'RS512', 'PS512', 'ES512'];

export type OidcClientErrorCode =
  | 'endpoint_invalid'
  | 'id_token_invalid'
  | 'issuer_invalid'
  | 'issuer_mismatch'
  | 'not_configured'
  | 'pkce_not_supported'
  | 'redirect_not_allowed'
  | 'response_too_large'
  | 'unsupported_client_auth'
  | 'unsupported_id_token_alg';

export class OidcClientError extends Error {
  /**
   * Create a stable OIDC client-policy error.
   *
   * @param code - Internal safe error classification.
   */
  constructor(readonly code: OidcClientErrorCode) {
    super(code);
    this.name = 'OidcClientError';
  }
}

export type TokenAuthenticationMethod = 'client_secret_basic' | 'client_secret_post' | 'none';

export interface OidcClientHandle {
  authenticationMethod: TokenAuthenticationMethod;
  config: oidc.Configuration;
  endpoints: { authorization: boolean; jwks: boolean; token: boolean; userinfo: boolean };
  idTokenAlgorithm: string;
  issuer: string;
  warnings: string[];
}

/**
 * Validate an OIDC URL and enforce HTTPS unless the explicit lab exception is enabled.
 *
 * @param raw - Untrusted URL value.
 * @param allowHttp - Whether isolated lab HTTP endpoints are allowed.
 * @param code - Error classification used for invalid input.
 * @returns The validated URL.
 * @throws OidcClientError - When the URL is malformed, unsafe, or uses a forbidden protocol.
 */
export function validateOidcUrl(raw: unknown, allowHttp: boolean, code: OidcClientErrorCode = 'endpoint_invalid'): URL {
  if (typeof raw !== 'string' || !raw || raw.length > 2048) throw new OidcClientError(code);
  let value: URL;
  try {
    value = new URL(raw);
  } catch {
    throw new OidcClientError(code);
  }
  if (!['https:', 'http:'].includes(value.protocol) || (value.protocol === 'http:' && !allowHttp))
    throw new OidcClientError(code);
  if (value.username || value.password || value.hash || raw.includes('#')) throw new OidcClientError(code);
  return value;
}

/**
 * Select a supported confidential- or public-client authentication method explicitly.
 *
 * @param advertised - Provider-advertised token endpoint methods.
 * @param hasSecret - Whether ezRepo has a configured client secret.
 * @returns The explicit token endpoint authentication method.
 * @throws OidcClientError - When no supported confidential-client method is advertised.
 */
export function selectTokenAuthenticationMethod(
  advertised: readonly string[] | undefined,
  hasSecret: boolean,
): TokenAuthenticationMethod {
  if (!hasSecret) return 'none';
  if (!advertised?.length || advertised.includes('client_secret_basic')) return 'client_secret_basic';
  if (advertised.includes('client_secret_post')) return 'client_secret_post';
  throw new OidcClientError('unsupported_client_auth');
}

/**
 * Select only an asymmetric ID-token signature algorithm.
 *
 * @param supported - Provider-advertised ID-token algorithms.
 * @returns The strongest supported algorithm according to ezRepo preference.
 * @throws OidcClientError - When the provider advertises no allowed asymmetric algorithm.
 */
export function selectIdTokenAlgorithm(supported: unknown): string {
  if (supported === undefined) return 'RS256';
  if (!Array.isArray(supported) || !supported.length || supported.some((value) => typeof value !== 'string' || !value))
    throw new OidcClientError('unsupported_id_token_alg');
  return (
    asymmetricAlgorithms.find((algorithm) => supported.includes(algorithm)) ??
    (() => {
      throw new OidcClientError('unsupported_id_token_alg');
    })()
  );
}

/**
 * Read a response body while enforcing a byte limit.
 *
 * @param response - Provider response to consume.
 * @param maximum - Maximum accepted body size in bytes.
 * @returns The complete bounded response body.
 * @throws OidcClientError - When the body exceeds the configured limit.
 */
async function readBounded(response: Response, maximum: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximum) throw new OidcClientError('response_too_large');
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new OidcClientError('response_too_large');
    }
    chunks.push(result.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Normalize an endpoint for size-limit matching without retaining query data.
 *
 * @param value - Endpoint URL.
 * @returns Its origin and path.
 */
function withoutQuery(value: string): string {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

/**
 * Create a redirect-free provider fetch implementation with endpoint-specific limits.
 *
 * @param endpoints - Getter for discovered provider endpoints.
 * @returns A hardened fetch implementation for openid-client.
 */
function boundedFetch(endpoints: () => { jwks?: string; token?: string; userinfo?: string }): oidc.CustomFetch {
  return async (url, options) => {
    const target = withoutQuery(String(url));
    const known = endpoints();
    const maximum =
      target === known.jwks
        ? responseLimits.jwks
        : target === known.token
          ? responseLimits.token
          : target === known.userinfo
            ? responseLimits.userinfo
            : responseLimits.discovery;
    const response = await fetch(url, { ...options, redirect: 'manual' } as RequestInit);
    if (response.status >= 300 && response.status < 400) throw new OidcClientError('redirect_not_allowed');
    const body = await readBounded(response, maximum);
    const headers = new Headers(response.headers);
    headers.delete('content-encoding');
    headers.delete('content-length');
    return new Response([101, 204, 205, 304].includes(response.status) ? null : (body as BodyInit), {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
}

/**
 * Discover and construct a hardened OIDC client configuration.
 *
 * @param input - Saved issuer and client credentials.
 * @returns A validated openid-client handle and safe discovery details.
 * @throws OidcClientError - When discovery metadata violates ezRepo policy.
 */
export async function buildOidcClient(input: {
  allowHttpIssuer: boolean;
  clientId: string;
  clientSecret: string | null;
  issuer: string;
}): Promise<OidcClientHandle> {
  const issuerUrl = validateOidcUrl(input.issuer, input.allowHttpIssuer, 'issuer_invalid');
  if (issuerUrl.search || input.issuer.includes('?')) throw new OidcClientError('issuer_invalid');
  let endpoints: { jwks?: string; token?: string; userinfo?: string } = {};
  const customFetch = boundedFetch(() => endpoints);
  const execute = input.allowHttpIssuer ? [oidc.allowInsecureRequests] : [];
  const discovered = await oidc.discovery(issuerUrl, input.clientId, undefined, oidc.None(), {
    [oidc.customFetch]: customFetch,
    execute,
    timeout: HTTP_TIMEOUT_SECONDS,
  });
  const metadata = discovered.serverMetadata();
  if (metadata.issuer !== input.issuer) throw new OidcClientError('issuer_mismatch');
  validateOidcUrl(metadata.authorization_endpoint, input.allowHttpIssuer);
  validateOidcUrl(metadata.token_endpoint, input.allowHttpIssuer);
  validateOidcUrl(metadata.jwks_uri, input.allowHttpIssuer);
  if (metadata.userinfo_endpoint) validateOidcUrl(metadata.userinfo_endpoint, input.allowHttpIssuer);
  endpoints = {
    jwks: withoutQuery(metadata.jwks_uri!),
    token: withoutQuery(metadata.token_endpoint!),
    userinfo: metadata.userinfo_endpoint ? withoutQuery(metadata.userinfo_endpoint) : undefined,
  };
  const warnings: string[] = [];
  if (metadata.code_challenge_methods_supported && !metadata.code_challenge_methods_supported.includes('S256'))
    throw new OidcClientError('pkce_not_supported');
  if (!metadata.code_challenge_methods_supported) warnings.push('pkce_support_not_advertised');
  const authenticationMethod = selectTokenAuthenticationMethod(
    metadata.token_endpoint_auth_methods_supported,
    input.clientSecret !== null,
  );
  const clientAuthentication =
    authenticationMethod === 'client_secret_basic'
      ? oidc.ClientSecretBasic(input.clientSecret!)
      : authenticationMethod === 'client_secret_post'
        ? oidc.ClientSecretPost(input.clientSecret!)
        : oidc.None();
  const idTokenAlgorithm = selectIdTokenAlgorithm(metadata.id_token_signing_alg_values_supported);
  const config = new oidc.Configuration(
    metadata,
    input.clientId,
    {
      ...(input.clientSecret ? { client_secret: input.clientSecret } : {}),
      id_token_signed_response_alg: idTokenAlgorithm,
    },
    clientAuthentication,
  );
  config[oidc.customFetch] = customFetch;
  config.timeout = HTTP_TIMEOUT_SECONDS;
  if (input.allowHttpIssuer) oidc.allowInsecureRequests(config);
  oidc.enableNonRepudiationChecks(config);
  return {
    authenticationMethod,
    config,
    endpoints: {
      authorization: true,
      jwks: true,
      token: true,
      userinfo: Boolean(metadata.userinfo_endpoint),
    },
    idTokenAlgorithm,
    issuer: input.issuer,
    warnings,
  };
}

/**
 * Create the authorization URL and its state, nonce, and S256 verifier.
 *
 * @param handle - Validated OIDC client handle.
 * @param callbackUrl - Exact registered callback URL.
 * @param scopes - Normalized requested scopes.
 * @returns The authorization URL and one-time transaction secrets.
 */
export async function createAuthorizationRequest(handle: OidcClientHandle, callbackUrl: string, scopes: string[]) {
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  return {
    codeVerifier,
    nonce,
    state,
    url: oidc.buildAuthorizationUrl(handle.config, {
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      nonce,
      redirect_uri: callbackUrl,
      scope: scopes.join(' '),
      state,
    }),
  };
}

/**
 * Exchange and validate one authorization response.
 *
 * @param handle - Validated OIDC client handle.
 * @param input - Callback parameters and expected transaction secrets.
 * @returns Verified token claims, subject, and optional UserInfo claims.
 * @throws OidcClientError - When the validated ID token has no stable subject.
 */
export async function exchangeAuthorizationCode(
  handle: OidcClientHandle,
  input: {
    callbackUrl: string;
    codeVerifier: string;
    expectedNonce: string;
    expectedState: string;
    parameters: URLSearchParams;
  },
) {
  const currentUrl = new URL(input.callbackUrl);
  for (const [key, value] of input.parameters.entries()) currentUrl.searchParams.append(key, value);
  const tokens = await oidc.authorizationCodeGrant(handle.config, currentUrl, {
    expectedNonce: input.expectedNonce,
    expectedState: input.expectedState,
    idTokenExpected: true,
    pkceCodeVerifier: input.codeVerifier,
  });
  const claims = tokens.claims();
  if (!claims?.sub) throw new OidcClientError('id_token_invalid');
  let userInfo: Record<string, unknown> | null = null;
  if (handle.endpoints.userinfo && tokens.access_token) {
    userInfo = { ...(await oidc.fetchUserInfo(handle.config, tokens.access_token, claims.sub)) };
  }
  return { claims: { ...claims } as Record<string, unknown>, subject: claims.sub, userInfo };
}

/**
 * Flatten a bounded error-cause chain for safe classification.
 *
 * @param error - Provider or protocol error.
 * @returns The bounded outer-to-inner error list.
 */
function errorChain(error: unknown): unknown[] {
  const errors: unknown[] = [];
  let current = error;
  for (let index = 0; index < 5 && current; index += 1) {
    errors.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return errors;
}

/**
 * Map provider and protocol failures to stable browser-facing error codes.
 *
 * @param error - Provider, network, or validation failure.
 * @returns A stable code containing no provider details.
 */
export function classifyOidcError(error: unknown): OidcErrorCode {
  const errors = errorChain(error);
  const own = errors.find((candidate) => candidate instanceof OidcClientError) as OidcClientError | undefined;
  if (own?.code === 'id_token_invalid') return 'oidc_token_invalid';
  if (own) return own.code === 'not_configured' ? 'oidc_not_configured' : 'oidc_unavailable';
  if (errors.some((candidate) => candidate instanceof oidc.AuthorizationResponseError)) return 'oidc_provider_error';
  if (errors.some((candidate) => candidate instanceof oidc.ResponseBodyError)) return 'oidc_provider_error';
  if (errors.some((candidate) => candidate instanceof TypeError)) return 'oidc_unavailable';
  return 'oidc_token_invalid';
}

/**
 * Perform a read-only discovery check for the saved configuration.
 *
 * @param record - Persisted secret-safe OIDC configuration.
 * @param clientSecret - Decrypted client secret when configured.
 * @returns Safe compatibility details or a stable failure code.
 */
export async function checkOidcDiscovery(
  record: OidcConfigRecord,
  clientSecret: string | null,
): Promise<OidcCheckResult> {
  if (!record.issuer || !record.clientId) return { code: 'not_configured', ok: false };
  try {
    const handle = await buildOidcClient({
      allowHttpIssuer: record.allowHttpIssuer,
      clientId: record.clientId,
      clientSecret,
      issuer: record.issuer,
    });
    return {
      endpoints: handle.endpoints,
      idTokenAlgorithm: handle.idTokenAlgorithm,
      issuer: handle.issuer,
      ok: true,
      tokenEndpointAuthenticationMethod: handle.authenticationMethod,
      warnings: handle.warnings,
    };
  } catch (error) {
    return { code: error instanceof OidcClientError ? error.code : classifyOidcError(error), ok: false };
  }
}
