import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadEnvironment } from './environment.js';

const originalEnv = process.env;

function setRequiredEnvironment(): void {
  process.env.AUTH_JWT_SECRET = 'a-long-test-secret';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/ezrepo_test';
  process.env.SHADOW_DATABASE_URL = 'postgresql://test:test@localhost:5432/ezrepo_shadow';
  process.env.TOKEN_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
}

describe('environment configuration', () => {
  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    setRequiredEnvironment();
    delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    delete process.env.WEB_PUSH_VAPID_SUBJECT;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('loads defaults for a valid configuration', () => {
    const environment = loadEnvironment(process.env);

    expect(environment.CORS_ORIGIN).toBe('http://localhost:3000');
    expect(environment.PORT).toBe(3001);
    expect(environment.SCHEDULER_ENABLED).toBe(true);
    expect(environment.SCHEDULER_SYNC_INTERVAL_SECONDS).toBe(1_800);
    expect(environment.WEB_PUSH_VAPID_PUBLIC_KEY).toBe('');
    expect(environment.isTest).toBe(true);
  });

  it('requires a complete browser-push VAPID configuration', () => {
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'public-key';

    expect(() => loadEnvironment(process.env)).toThrow('WEB_PUSH_VAPID_PRIVATE_KEY');
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    process.env.TOKEN_ENCRYPTION_KEY = 'not-a-valid-32-byte-key';

    expect(() => loadEnvironment(process.env)).toThrow('TOKEN_ENCRYPTION_KEY');
  });

  it('requires an OAuth client secret when an OAuth client ID is configured', () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = 'github-client';

    expect(() => loadEnvironment(process.env)).toThrow('GITHUB_OAUTH_CLIENT_SECRET');
  });

  it('uses deliberately unusable secret placeholders in the environment template', () => {
    const template = readFileSync(resolve(__dirname, '../../../../.env.example'), 'utf8');

    expect(template).toContain('POSTGRES_PASSWORD=replace-with-a-unique-postgresql-password');
    expect(template).not.toContain('INITIAL_ADMIN_PASSWORD');
    expect(template).not.toContain('INITIAL_ADMIN_USERNAME');
    expect(template).toContain('TOKEN_ENCRYPTION_KEY=replace-with-a-base64-encoded-32-byte-key');
    expect(template).not.toContain('MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=');
  });
});
