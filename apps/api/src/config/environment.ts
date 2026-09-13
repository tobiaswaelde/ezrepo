import type { CleanedEnv, ReporterOptions } from 'envalid';
import { bool, cleanEnv, makeValidator, num, str } from 'envalid';

const base64Key = makeValidator<string>((input) => {
  const decoded = Buffer.from(input, 'base64');

  if (decoded.length !== 32 || decoded.toString('base64') !== input) {
    throw new Error('must be a canonical base64 value that decodes to exactly 32 bytes');
  }

  return input;
});

const httpUrl = makeValidator<string>((input) => {
  const url = new URL(input);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('must use the http or https protocol');
  }

  return input;
});

const positiveInteger = makeValidator<number>((input) => {
  const value = Number(input);

  if (!Number.isInteger(value) || value < 1) {
    throw new Error('must be a positive integer');
  }

  return value;
});

const validators = {
  NODE_ENV: str({ choices: ['development', 'production', 'test'], default: 'development' }),
  PORT: num({ default: 3001 }),
  DATABASE_URL: str({ desc: 'PostgreSQL connection URL' }),
  SHADOW_DATABASE_URL: str({ desc: 'PostgreSQL shadow database URL for migrations' }),
  CORS_ORIGIN: str({ default: 'http://localhost:3000' }),
  PUBLIC_URL: httpUrl({ default: 'http://localhost:3000', desc: 'Public ezRepo web URL' }),
  AUTH_JWT_ISSUER: str({ default: 'ezrepo' }),
  AUTH_JWT_SECRET: str({ desc: 'JWT signing secret' }),
  AUTH_JWT_EXPIRATION: str({ default: '7d' }),
  TOKEN_ENCRYPTION_KEY: base64Key({ desc: 'Base64-encoded 32-byte encryption key' }),
  WEB_PUSH_VAPID_PUBLIC_KEY: str({ default: '' }),
  WEB_PUSH_VAPID_PRIVATE_KEY: str({ default: '' }),
  WEB_PUSH_VAPID_SUBJECT: str({ default: '' }),
  OAUTH_CALLBACK_URL: httpUrl({
    default: 'http://localhost:3001/api/v1/provider-accounts/oauth/callback',
    desc: 'Public API callback URL registered with OAuth providers',
  }),
  GITHUB_OAUTH_CLIENT_ID: str({ default: '' }),
  GITHUB_OAUTH_CLIENT_SECRET: str({ default: '' }),
  GITLAB_OAUTH_BASE_URL: httpUrl({ default: 'https://gitlab.com' }),
  GITLAB_OAUTH_CLIENT_ID: str({ default: '' }),
  GITLAB_OAUTH_CLIENT_SECRET: str({ default: '' }),
  FORGEJO_OAUTH_BASE_URL: str({ default: '' }),
  FORGEJO_OAUTH_CLIENT_ID: str({ default: '' }),
  FORGEJO_OAUTH_CLIENT_SECRET: str({ default: '' }),
  SCHEDULER_ENABLED: bool({ default: true }),
  SCHEDULER_SYNC_INTERVAL_SECONDS: positiveInteger({ default: 1_800 }),
};

/** The validated API runtime configuration. */
export type EzRepoEnvironment = CleanedEnv<typeof validators>;

function throwOnInvalidEnvironment<T>({ errors }: ReporterOptions<T>): void {
  const messages = Object.entries(errors as Record<string, Error | undefined>).map(
    ([key, error]) => `${key}: ${error?.message ?? 'is invalid'}`,
  );

  if (messages.length > 0) {
    throw new Error(`Invalid ezRepo environment configuration: ${messages.join(', ')}`);
  }
}

/**
 * Validate ezRepo environment variables without logging their values.
 *
 * @param environment - Raw environment variables to validate.
 * @returns A read-only, typed configuration object.
 * @throws {Error} When required values are missing or cross-field validation fails.
 */
export function loadEnvironment(environment: NodeJS.ProcessEnv): EzRepoEnvironment {
  const config = cleanEnv(environment, validators, { reporter: throwOnInvalidEnvironment });

  const oauthClients = [
    [
      'GITHUB_OAUTH_CLIENT_ID',
      config.GITHUB_OAUTH_CLIENT_ID,
      'GITHUB_OAUTH_CLIENT_SECRET',
      config.GITHUB_OAUTH_CLIENT_SECRET,
    ],
    [
      'GITLAB_OAUTH_CLIENT_ID',
      config.GITLAB_OAUTH_CLIENT_ID,
      'GITLAB_OAUTH_CLIENT_SECRET',
      config.GITLAB_OAUTH_CLIENT_SECRET,
    ],
    [
      'FORGEJO_OAUTH_CLIENT_ID',
      config.FORGEJO_OAUTH_CLIENT_ID,
      'FORGEJO_OAUTH_CLIENT_SECRET',
      config.FORGEJO_OAUTH_CLIENT_SECRET,
    ],
  ] as const;

  for (const [idName, clientId, secretName, clientSecret] of oauthClients) {
    if (Boolean(clientId) !== Boolean(clientSecret)) {
      throw new Error(`${idName} and ${secretName} must be configured together`);
    }
  }

  if (config.FORGEJO_OAUTH_CLIENT_ID && !config.FORGEJO_OAUTH_BASE_URL) {
    throw new Error('FORGEJO_OAUTH_BASE_URL is required when Forgejo OAuth is configured');
  }

  const webPushValues = [
    config.WEB_PUSH_VAPID_PUBLIC_KEY,
    config.WEB_PUSH_VAPID_PRIVATE_KEY,
    config.WEB_PUSH_VAPID_SUBJECT,
  ];
  if (webPushValues.some(Boolean) && !webPushValues.every(Boolean)) {
    throw new Error(
      'WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY, and WEB_PUSH_VAPID_SUBJECT must be configured together',
    );
  }
  if (
    config.WEB_PUSH_VAPID_SUBJECT &&
    !config.WEB_PUSH_VAPID_SUBJECT.startsWith('mailto:') &&
    !config.WEB_PUSH_VAPID_SUBJECT.startsWith('https://')
  ) {
    throw new Error('WEB_PUSH_VAPID_SUBJECT must use mailto: or https://');
  }

  return config;
}
