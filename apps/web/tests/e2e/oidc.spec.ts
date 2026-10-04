import { expect, test } from '@playwright/test';

const administrator = {
  authProvider: 'LOCAL',
  avatarUpdatedAt: null,
  firstName: 'Vera',
  id: 'administrator-id',
  lastName: 'Admin',
  role: 'SYSTEM_ADMIN',
  username: 'vera',
} as const;

test('shows the optional provider-named SSO action without replacing local sign-in', async ({ page }, testInfo) => {
  await page.route('**/api/v1/auth/setup-status', (route) => route.fulfill({ json: { initialized: true } }));
  await page.route('**/api/v1/auth/oidc/status', (route) =>
    route.fulfill({ json: { enabled: true, providerName: 'Company SSO' } }),
  );

  await page.goto('/auth/signin');

  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in with Company SSO' })).toHaveAttribute(
    'href',
    /\/api\/v1\/auth\/oidc\/start$/,
  );
  await page.screenshot({ path: testInfo.outputPath('oidc-sign-in-desktop.png'), fullPage: true });

  await page.setViewportSize({ height: 844, width: 390 });
  await expect(page.getByRole('link', { name: 'Sign in with Company SSO' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('oidc-sign-in-mobile.png'), fullPage: true });
});

test('removes the handoff code from the URL before exchanging it for a normal bearer session', async ({ page }) => {
  const browserMessages: string[] = [];
  page.on('console', (message) => browserMessages.push(message.text()));
  let releaseExchange: (() => void) | undefined;
  const exchangeGate = new Promise<void>((resolve) => {
    releaseExchange = resolve;
  });
  await page.route('**/api/v1/auth/setup-status', (route) => route.fulfill({ json: { initialized: true } }));
  await page.route('**/api/v1/auth/oidc/exchange', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ code: 'opaque-one-time-code' });
    await expect(page).toHaveURL('http://[::1]:3000/auth/oidc/callback');
    await exchangeGate;
    await route.fulfill({
      json: {
        accessToken: 'oidc-access-token',
        returnTo: '/admin/settings',
        user: { ...administrator, authProvider: 'OIDC' },
      },
    });
  });

  await page.goto('/auth/oidc/callback#code=opaque-one-time-code');
  await expect(page.getByRole('heading', { name: 'Completing sign-in' })).toBeVisible();
  releaseExchange?.();

  await expect(page).toHaveURL('/admin/settings');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ezrepo.access-token'))).toBe('oidc-access-token');
  expect(browserMessages.join('\n')).not.toContain('opaque-one-time-code');
});

test('configures OIDC through the administrator-only authentication page', async ({ page }, testInfo) => {
  const oidcConfig = {
    allowHttpIssuer: false,
    allowUnmatchedViewer: false,
    callbackUrl: 'https://ezrepo.example.com/api/v1/auth/oidc/callback',
    clientId: 'ezrepo',
    clientSecretConfigured: true,
    configRevision: 2,
    enabled: true,
    groupsClaim: 'groups',
    issuer: 'https://id.example/application/o/ezrepo/',
    managerGroups: ['ezrepo-managers'],
    observedGroups: ['ezrepo-admins', 'ezrepo-viewers'],
    providerName: 'Company SSO',
    scopes: ['openid', 'profile', 'email'],
    secretDecryptable: true,
    systemAdministratorGroups: ['ezrepo-admins'],
    updatedAt: '2026-10-04T12:00:00.000Z',
    viewerGroups: ['ezrepo-viewers'],
  };
  await page.addInitScript(() => localStorage.setItem('ezrepo.access-token', 'administrator-token'));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: administrator }));
  await page.route('**/api/v1/auth/oidc/config', (route) => route.fulfill({ json: oidcConfig }));
  await page.route('**/api/v1/auth/oidc/check', (route) =>
    route.fulfill({
      json: {
        endpoints: { authorization: true, jwks: true, token: true, userinfo: true },
        idTokenAlgorithm: 'RS256',
        issuer: oidcConfig.issuer,
        ok: true,
        tokenEndpointAuthenticationMethod: 'client_secret_basic',
      },
    }),
  );

  await page.goto('/admin/settings/authentication');

  await expect(page.getByRole('heading', { name: 'OpenID Connect' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Authentication' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('textbox', { name: 'Client secret' })).toHaveValue('');
  await expect(page.getByText('Leave blank to retain the stored secret.')).toBeVisible();
  await expect(page.getByText('ezrepo-admins', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check connection' }).click();
  await expect(page.getByText('OIDC discovery succeeded')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('oidc-administration.png'), fullPage: true });
});

test('marks OIDC users and keeps only their local avatar editable', async ({ page }) => {
  const oidcAdministrator = { ...administrator, authProvider: 'OIDC' as const, username: 'oidc_admin' };
  await page.addInitScript(() => localStorage.setItem('ezrepo.access-token', 'oidc-administrator-token'));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: oidcAdministrator }));
  await page.route(/\/api\/v1\/users(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            ...oidcAdministrator,
            createdAt: '2026-10-04T12:00:00.000Z',
            updatedAt: '2026-10-04T12:00:00.000Z',
          },
        ],
        meta: { itemCount: 1, pageCount: 1 },
      },
    }),
  );

  await page.goto('/admin/settings');
  await expect(page.getByText('Identity managed by single sign-on')).toBeVisible();
  await expect(page.getByText('Profile picture', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Username')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change password' })).toHaveCount(0);

  await page.goto('/admin/users');
  await expect(page.getByRole('cell', { name: 'OpenID Connect' })).toBeVisible();
});
