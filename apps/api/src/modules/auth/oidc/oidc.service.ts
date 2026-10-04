import { createHash, randomBytes } from 'node:crypto';

import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import type { OidcConfig, User } from '../../../generated/prisma/client.js';

import { ENV } from '../../../config/env.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CredentialEncryptionService } from '../../../security/credential-encryption.service.js';
import { AuthService } from '../auth.service.js';
import type { OidcConfigDto, UpdateOidcConfigDto } from '../dto/oidc.dto.js';
import type { AuthResult } from '../types.js';
import { decideOidcAccess, deriveOidcUsername, extractGroups, sanitizeObservedGroups } from './oidc-claims.js';
import {
  buildOidcClient,
  checkOidcDiscovery,
  classifyOidcError,
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  validateOidcUrl,
} from './oidc-client.js';
import type { OidcCheckResult, OidcErrorCode } from './oidc.types.js';

const configKey = 'global';
const transactionLifetimeMs = 10 * 60 * 1000;
const exchangeLifetimeMs = 60 * 1000;
const bindingPattern = /^[A-Za-z0-9_-]{43}$/;
const maximumPendingTransactions = 20;

interface BeginResult {
  bindingIsNew: boolean;
  bindingValue: string;
  redirectUrl: string;
}

interface CallbackResult {
  code?: string;
  error?: OidcErrorCode;
}

export interface OidcExchangeResult extends AuthResult {
  returnTo: string;
}

/** Orchestrates OIDC configuration, protocol transactions, account provisioning, and browser handoff. */
@Injectable()
export class OidcService {
  /**
   * Create the OIDC orchestration service.
   *
   * @param prisma - Database access and transaction service.
   * @param credentials - At-rest credential encryption service.
   * @param auth - Existing bearer-session service.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: CredentialEncryptionService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Return public SSO availability without disclosing configuration details.
   *
   * @returns Effective availability and optional provider display name.
   */
  async status(): Promise<{ enabled: boolean; providerName?: string }> {
    const config = await this.getConfig();
    const enabled = this.isReady(config);
    return { enabled, ...(enabled && config.providerName ? { providerName: config.providerName } : {}) };
  }

  /**
   * Return the administrator-safe persisted OIDC configuration.
   *
   * @returns Configuration metadata without secret material.
   */
  async config(): Promise<OidcConfigDto> {
    return this.toConfigDto(await this.getConfig());
  }

  /**
   * Update normalized OIDC policy and invalidate sessions when security-relevant values change.
   *
   * @param input - Validated partial configuration update.
   * @returns The updated secret-free configuration.
   * @throws BadRequestException - When settings are incomplete, conflicting, or unsafe.
   */
  async updateConfig(input: UpdateOidcConfigDto): Promise<OidcConfigDto> {
    if (input.clientSecret && input.clientSecretClear) {
      throw new BadRequestException('The client secret cannot be set and cleared at the same time.');
    }
    const current = await this.getConfig();
    const issuer = input.issuer === undefined ? current.issuer : input.issuer?.trim() || null;
    const allowHttpIssuer = input.allowHttpIssuer ?? current.allowHttpIssuer;
    if (issuer) {
      const parsed = validateOidcUrl(issuer, allowHttpIssuer, 'issuer_invalid');
      if (parsed.search || issuer.includes('?')) throw new BadRequestException('The issuer URL is invalid.');
    }
    const scopes = input.scopes ? this.normalizeScopes(input.scopes) : current.scopes;
    const update = {
      allowHttpIssuer,
      allowUnmatchedViewer: input.allowUnmatchedViewer ?? current.allowUnmatchedViewer,
      clientId: input.clientId === undefined ? current.clientId : input.clientId?.trim() || null,
      enabled: input.enabled ?? current.enabled,
      groupsClaim: input.groupsClaim?.trim() ?? current.groupsClaim,
      issuer,
      managerGroups: input.managerGroups ? this.normalizeGroups(input.managerGroups) : current.managerGroups,
      providerName:
        input.providerName === undefined ? current.providerName : input.providerName?.trim().slice(0, 64) || null,
      scopes,
      systemAdministratorGroups: input.systemAdministratorGroups
        ? this.normalizeGroups(input.systemAdministratorGroups)
        : current.systemAdministratorGroups,
      viewerGroups: input.viewerGroups ? this.normalizeGroups(input.viewerGroups) : current.viewerGroups,
    };
    const encryptedClientSecret = input.clientSecret
      ? this.credentials.encrypt(input.clientSecret)
      : input.clientSecretClear
        ? null
        : current.encryptedClientSecret;
    if (update.enabled && (!update.issuer || !update.clientId))
      throw new BadRequestException('Issuer and client ID are required before OIDC can be enabled.');
    const securityChanged =
      encryptedClientSecret !== current.encryptedClientSecret ||
      Object.entries(update).some(
        ([key, value]) => key !== 'providerName' && !this.equal(value, current[key as keyof OidcConfig]),
      );
    const saved = await this.prisma.transaction(async (transaction) => {
      const record = await transaction.oidcConfig.update({
        data: {
          ...update,
          encryptedClientSecret,
          configRevision: securityChanged ? { increment: 1 } : undefined,
        },
        where: { id: current.id },
      });
      if (securityChanged) {
        await Promise.all([
          transaction.oidcLoginTransaction.deleteMany(),
          transaction.oidcSessionExchange.deleteMany(),
          transaction.user.updateMany({ data: { authVersion: { increment: 1 } }, where: { authProvider: 'OIDC' } }),
        ]);
      }
      return record;
    });
    return this.toConfigDto(saved);
  }

  /**
   * Perform read-only discovery against the saved configuration.
   *
   * @returns Safe provider compatibility details.
   */
  async check(): Promise<OidcCheckResult> {
    const config = await this.getConfig();
    try {
      return checkOidcDiscovery(config, this.clientSecret(config));
    } catch {
      return { code: 'secret_unavailable', ok: false };
    }
  }

  /**
   * Start one Authorization Code and PKCE login transaction.
   *
   * @param existingBinding - Existing browser-binding cookie value.
   * @param returnTo - Requested post-login internal path.
   * @returns Provider redirect data and the browser binding.
   * @throws UnauthorizedException - When OIDC is not configured for use.
   * @throws HttpException - When the browser exceeds the pending-transaction limit.
   */
  async begin(existingBinding: string | undefined, returnTo: unknown): Promise<BeginResult> {
    const config = await this.getConfig();
    if (!this.isReady(config)) throw new UnauthorizedException('OIDC is not configured.');
    const client = await this.client(config);
    const authorization = await createAuthorizationRequest(client, ENV.OIDC_CALLBACK_URL, config.scopes);
    const bindingIsNew = !existingBinding || !bindingPattern.test(existingBinding);
    const bindingValue = bindingIsNew ? randomBytes(32).toString('base64url') : existingBinding;
    const bindingHash = this.hash(`binding:${bindingValue}`);
    await this.prisma.transaction(async (transaction) => {
      await transaction.oidcLoginTransaction.deleteMany({ where: { expiresAt: { lte: new Date() } } });
      const pending = await transaction.oidcLoginTransaction.count({
        where: { bindingHash, consumedAt: null, expiresAt: { gt: new Date() } },
      });
      if (pending >= maximumPendingTransactions)
        throw new HttpException('Too many pending OIDC logins.', HttpStatus.TOO_MANY_REQUESTS);
      await transaction.oidcLoginTransaction.create({
        data: {
          bindingHash,
          codeVerifier: authorization.codeVerifier,
          configRevision: config.configRevision,
          expiresAt: new Date(Date.now() + transactionLifetimeMs),
          nonce: authorization.nonce,
          returnTo: this.sanitizeReturnTo(returnTo),
          stateHash: this.hash(authorization.state),
        },
      });
    });
    return { bindingIsNew, bindingValue, redirectUrl: authorization.url.toString() };
  }

  /**
   * Complete one provider callback and mint a short-lived browser exchange code.
   *
   * @param parameters - Provider callback parameters.
   * @param bindingValue - Browser-binding cookie value.
   * @returns A one-time exchange code or a stable error code.
   */
  async callback(parameters: URLSearchParams, bindingValue: string | undefined): Promise<CallbackResult> {
    const state = parameters.get('state');
    if (!state || !bindingValue || !bindingPattern.test(bindingValue)) return { error: 'oidc_transaction_invalid' };
    const config = await this.getConfig();
    if (!this.isReady(config)) return { error: 'oidc_not_configured' };
    const transaction = await this.prisma.transaction(async (database) => {
      const record = await database.oidcLoginTransaction.findUnique({ where: { stateHash: this.hash(state) } });
      if (
        !record ||
        record.consumedAt ||
        record.expiresAt <= new Date() ||
        record.bindingHash !== this.hash(`binding:${bindingValue}`) ||
        record.configRevision !== config.configRevision
      )
        return null;
      const consumed = await database.oidcLoginTransaction.updateMany({
        data: { consumedAt: new Date() },
        where: { consumedAt: null, id: record.id },
      });
      return consumed.count === 1 ? record : null;
    });
    if (!transaction) return { error: 'oidc_transaction_invalid' };
    if (parameters.get('error')) return { error: 'oidc_provider_error' };
    if (!parameters.get('code')) return { error: 'oidc_invalid_request' };
    try {
      const login = await exchangeAuthorizationCode(await this.client(config), {
        callbackUrl: ENV.OIDC_CALLBACK_URL,
        codeVerifier: transaction.codeVerifier,
        expectedNonce: transaction.nonce,
        expectedState: state,
        parameters,
      });
      const idTokenGroups = extractGroups(login.claims, config.groupsClaim);
      const groups =
        idTokenGroups.status === 'missing' && login.userInfo
          ? extractGroups(login.userInfo, config.groupsClaim)
          : idTokenGroups;
      const decision = decideOidcAccess(groups, config);
      if (!decision.ok) {
        await this.prisma.user.updateMany({
          data: { authVersion: { increment: 1 } },
          where: { authProvider: 'OIDC', oidcIssuer: config.issuer, oidcSubject: login.subject },
        });
        return { error: 'oidc_access_denied' };
      }
      const claims = { ...(login.userInfo ?? {}), ...login.claims };
      const user = await this.provisionUser(config.issuer!, login.subject, decision.role, claims);
      await this.recordObservedGroups(config, decision.groups);
      const code = randomBytes(32).toString('base64url');
      await this.prisma.oidcSessionExchange.create({
        data: {
          codeHash: this.hash(code),
          expiresAt: new Date(Date.now() + exchangeLifetimeMs),
          returnTo: transaction.returnTo ?? '/',
          userId: user.id,
        },
      });
      return { code };
    } catch (error) {
      const detail = error instanceof Error ? error.name.replace(/[^\w.-]/g, '_').slice(0, 64) : 'error';
      console.warn(`OIDC login failed: ${classifyOidcError(error)} (${detail})`);
      return { error: classifyOidcError(error) };
    }
  }

  /**
   * Atomically exchange one browser handoff code for the normal ezRepo bearer session.
   *
   * @param code - Opaque one-time exchange code.
   * @returns The normal authentication result and validated return path.
   * @throws UnauthorizedException - When the code is invalid, expired, or already consumed.
   */
  async exchange(code: string): Promise<OidcExchangeResult> {
    const exchange = await this.prisma.transaction(async (transaction) => {
      const record = await transaction.oidcSessionExchange.findUnique({ where: { codeHash: this.hash(code) } });
      if (!record || record.consumedAt || record.expiresAt <= new Date()) return null;
      const consumed = await transaction.oidcSessionExchange.updateMany({
        data: { consumedAt: new Date() },
        where: { consumedAt: null, id: record.id },
      });
      return consumed.count === 1 ? record : null;
    });
    if (!exchange) throw new UnauthorizedException('The OIDC exchange code is invalid or expired.');
    return { ...(await this.auth.createSession(exchange.userId)), returnTo: exchange.returnTo };
  }

  /**
   * Load or initialize the singleton OIDC configuration.
   *
   * @returns The persisted singleton record.
   */
  private async getConfig(): Promise<OidcConfig> {
    return this.prisma.oidcConfig.upsert({ create: { key: configKey }, update: {}, where: { key: configKey } });
  }

  /**
   * Determine effective public availability, including secret decryptability.
   *
   * @param config - Persisted OIDC configuration.
   * @returns Whether login can be started safely.
   */
  private isReady(config: OidcConfig): boolean {
    if (!config.enabled || !config.issuer || !config.clientId) return false;
    try {
      this.clientSecret(config);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Decrypt the configured client secret only for immediate protocol use.
   *
   * @param config - Persisted OIDC configuration.
   * @returns The plaintext secret or null for a public client.
   */
  private clientSecret(config: OidcConfig): string | null {
    return config.encryptedClientSecret ? this.credentials.decrypt(config.encryptedClientSecret) : null;
  }

  /**
   * Discover and construct a hardened provider client.
   *
   * @param config - Complete persisted OIDC configuration.
   * @returns A validated provider client handle.
   * @throws BadRequestException - When issuer or client ID is missing.
   */
  private client(config: OidcConfig) {
    if (!config.issuer || !config.clientId) throw new BadRequestException('OIDC is not configured.');
    return buildOidcClient({
      allowHttpIssuer: config.allowHttpIssuer,
      clientId: config.clientId,
      clientSecret: this.clientSecret(config),
      issuer: config.issuer,
    });
  }

  /**
   * Map persisted configuration to its secret-free administrator contract.
   *
   * @param config - Persisted OIDC configuration.
   * @returns The safe administrator DTO.
   */
  private toConfigDto(config: OidcConfig): OidcConfigDto {
    let secretDecryptable = true;
    if (config.encryptedClientSecret) {
      try {
        this.credentials.decrypt(config.encryptedClientSecret);
      } catch {
        secretDecryptable = false;
      }
    }
    return {
      allowHttpIssuer: config.allowHttpIssuer,
      allowUnmatchedViewer: config.allowUnmatchedViewer,
      callbackUrl: ENV.OIDC_CALLBACK_URL,
      clientId: config.clientId,
      clientSecretConfigured: Boolean(config.encryptedClientSecret),
      configRevision: config.configRevision,
      enabled: config.enabled,
      groupsClaim: config.groupsClaim,
      issuer: config.issuer,
      managerGroups: config.managerGroups,
      observedGroups: config.observedGroups,
      providerName: config.providerName,
      scopes: config.scopes,
      secretDecryptable,
      systemAdministratorGroups: config.systemAdministratorGroups,
      updatedAt: config.updatedAt,
      viewerGroups: config.viewerGroups,
    };
  }

  /**
   * Create or synchronize an identity linked only by verified issuer and subject.
   *
   * @param issuer - Verified identity-provider issuer.
   * @param subject - Verified stable subject.
   * @param role - Role selected from exact group mappings.
   * @param claims - Verified profile claims.
   * @returns The provisioned or synchronized user.
   */
  private async provisionUser(
    issuer: string,
    subject: string,
    role: User['role'],
    claims: Record<string, unknown>,
  ): Promise<User> {
    const firstName = this.claimText(claims.given_name);
    const lastName = this.claimText(claims.family_name);
    let username = deriveOidcUsername(issuer, subject);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const owner = await this.prisma.user.findUnique({
        where: { username },
        select: { oidcIssuer: true, oidcSubject: true },
      });
      if (!owner || (owner.oidcIssuer === issuer && owner.oidcSubject === subject)) break;
      username = deriveOidcUsername(issuer, subject, attempt + 1);
    }
    const existing = await this.prisma.user.findUnique({
      where: { oidcIssuer_oidcSubject: { oidcIssuer: issuer, oidcSubject: subject } },
    });
    return this.prisma.user.upsert({
      create: { authProvider: 'OIDC', firstName, lastName, oidcIssuer: issuer, oidcSubject: subject, role, username },
      update: {
        authVersion: existing && existing.role !== role ? { increment: 1 } : undefined,
        firstName,
        lastName,
        role,
      },
      where: { oidcIssuer_oidcSubject: { oidcIssuer: issuer, oidcSubject: subject } },
    });
  }

  /**
   * Retain bounded group suggestions from successful sign-ins.
   *
   * @param config - Current persisted configuration.
   * @param incoming - Groups from the successful login.
   * @returns Nothing after any required update.
   */
  private async recordObservedGroups(config: OidcConfig, incoming: string[]): Promise<void> {
    const merged = sanitizeObservedGroups([...config.observedGroups, ...incoming]);
    if (!this.equal(merged, config.observedGroups))
      await this.prisma.oidcConfig.update({ data: { observedGroups: merged }, where: { id: config.id } });
  }

  /**
   * Normalize exact administrator-configured group values.
   *
   * @param groups - Raw submitted group names.
   * @returns Trimmed unique non-empty names.
   */
  private normalizeGroups(groups: string[]): string[] {
    return [...new Set(groups.map((group) => group.trim()).filter(Boolean))];
  }

  /**
   * Normalize scopes while ensuring the required OpenID scope.
   *
   * @param scopes - Raw submitted scopes.
   * @returns Normalized unique scopes containing openid.
   * @throws BadRequestException - When no usable scope was submitted.
   */
  private normalizeScopes(scopes: string[]): string[] {
    const normalized = [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))];
    if (!normalized.length) throw new BadRequestException('At least one OIDC scope is required.');
    return normalized.includes('openid') ? normalized : ['openid', ...normalized];
  }

  /**
   * Restrict post-login navigation to safe internal application paths.
   *
   * @param value - Untrusted requested path.
   * @returns A safe internal path or the application root.
   */
  private sanitizeReturnTo(value: unknown): string {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
      return '/';
    if (value.length > 512 || value.startsWith('/api/') || value.startsWith('/auth/')) return '/';
    return value;
  }

  /**
   * Normalize one bounded profile-name claim.
   *
   * @param value - Untrusted verified-claim value.
   * @returns A safe profile string or null.
   */
  private claimText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    // eslint-disable-next-line no-control-regex
    const normalized = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return normalized ? normalized.slice(0, 255) : null;
  }

  /**
   * Hash an ephemeral protocol secret before persistence or lookup.
   *
   * @param value - Secret value to hash.
   * @returns Its lowercase SHA-256 digest.
   */
  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  /**
   * Compare normalized JSON-compatible configuration values.
   *
   * @param left - First normalized value.
   * @param right - Second normalized value.
   * @returns Whether their JSON representations match.
   */
  private equal(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }
}
