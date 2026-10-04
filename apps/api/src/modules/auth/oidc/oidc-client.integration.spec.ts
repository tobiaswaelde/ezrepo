import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { buildOidcClient, exchangeAuthorizationCode } from './oidc-client.js';

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

describe('OIDC client against a signed HTTP mock provider', () => {
  const signingKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = { ...signingKeys.publicKey.export({ format: 'jwk' }), alg: 'RS256', kid: 'test-key', use: 'sig' };
  let server: Server;
  let issuer: string;
  let expectedVerifier = 'expected-code-verifier';
  let claimOverrides: Record<string, unknown> = {};
  let useWrongSigningKey = false;

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/.well-known/openid-configuration') {
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            authorization_endpoint: `${issuer}/authorize`,
            code_challenge_methods_supported: ['S256'],
            id_token_signing_alg_values_supported: ['RS256'],
            issuer,
            jwks_uri: `${issuer}/jwks`,
            response_types_supported: ['code'],
            subject_types_supported: ['public'],
            token_endpoint: `${issuer}/token`,
            token_endpoint_auth_methods_supported: ['none'],
          }),
        );
        return;
      }
      if (request.url === '/jwks') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ keys: [publicJwk] }));
        return;
      }
      if (request.url === '/token' && request.method === 'POST') {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          const body = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
          if (body.get('code_verifier') !== expectedVerifier) {
            response.statusCode = 400;
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ error: 'invalid_grant' }));
            return;
          }
          const now = Math.floor(Date.now() / 1000);
          const header = encodeJson({ alg: 'RS256', kid: 'test-key', typ: 'JWT' });
          const payload = encodeJson({
            aud: 'ezrepo',
            exp: now + 60,
            groups: ['ezrepo-viewers'],
            iat: now,
            iss: issuer,
            nonce: 'expected-nonce',
            sub: 'stable-subject',
            ...claimOverrides,
          });
          const signature = sign(
            'RSA-SHA256',
            Buffer.from(`${header}.${payload}`, 'utf8'),
            useWrongSigningKey ? otherKeys.privateKey : signingKeys.privateKey,
          ).toString('base64url');
          response.setHeader('Content-Type', 'application/json');
          response.end(
            JSON.stringify({
              access_token: randomUUID(),
              id_token: `${header}.${payload}.${signature}`,
              token_type: 'Bearer',
            }),
          );
        });
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Mock provider did not bind a TCP port.');
    issuer = `http://127.0.0.1:${address.port}`;
  });

  afterAll(
    async () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  );

  beforeEach(() => {
    claimOverrides = {};
    expectedVerifier = 'expected-code-verifier';
    useWrongSigningKey = false;
  });

  async function exchange(input: { nonce?: string; state?: string; verifier?: string } = {}) {
    const handle = await buildOidcClient({
      allowHttpIssuer: true,
      clientId: 'ezrepo',
      clientSecret: null,
      issuer,
    });
    return exchangeAuthorizationCode(handle, {
      callbackUrl: 'http://127.0.0.1/callback',
      codeVerifier: input.verifier ?? 'expected-code-verifier',
      expectedNonce: input.nonce ?? 'expected-nonce',
      expectedState: 'expected-state',
      parameters: new URLSearchParams({ code: 'authorization-code', state: input.state ?? 'expected-state' }),
    });
  }

  it('accepts a correctly signed authorization-code response with nonce, state, audience, issuer, and subject', async () => {
    await expect(exchange()).resolves.toMatchObject({
      claims: { groups: ['ezrepo-viewers'] },
      subject: 'stable-subject',
    });
  });

  it.each([
    ['issuer', { iss: 'http://other.example' }],
    ['audience', { aud: 'another-client' }],
    ['nonce', { nonce: 'wrong-nonce' }],
    ['subject', { sub: undefined }],
  ])('rejects a token with an invalid %s', async (_name, overrides) => {
    claimOverrides = overrides;
    await expect(exchange()).rejects.toBeDefined();
  });

  it('rejects a token with a signature outside the discovered JWKS', async () => {
    useWrongSigningKey = true;
    await expect(exchange()).rejects.toBeDefined();
  });

  it('rejects state and PKCE verifier mismatches', async () => {
    await expect(exchange({ state: 'wrong-state' })).rejects.toBeDefined();
    expectedVerifier = 'different-verifier';
    await expect(exchange()).rejects.toBeDefined();
  });
});
