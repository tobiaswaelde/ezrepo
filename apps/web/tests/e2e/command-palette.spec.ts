import { expect, test, type Page } from '@playwright/test';

const emptyPage = {
  items: [],
  meta: { hasNextPage: false, hasPrevPage: false, itemCount: 0, page: 1, pageCount: 0, perPage: 20 },
};
const providerAccount = {
  baseUrl: null,
  displayName: 'ezRepo GitHub',
  enabled: true,
  id: 'provider-1',
  lastSyncAt: null,
  providerType: 'GITHUB',
};
const repository = {
  enabled: true,
  id: 'repository-1',
  lastSyncAt: null,
  name: 'ezrepo',
  owner: 'tobiaswaelde',
  providerAccountId: 'provider-1',
  url: 'https://github.com/tobiaswaelde/ezrepo',
  workflowRunRetentionDays: null,
};
const workflowRun = {
  completedAt: '2026-09-10T00:01:00.000Z',
  displayTitle: 'Deploy main',
  durationMs: 60_000,
  id: 'workflow-run-1',
  providerCreatedAt: '2026-09-10T00:00:00.000Z',
  providerRunId: '42',
  providerType: 'GITHUB',
  repositoryId: 'repository-1',
  repositoryName: 'ezrepo',
  repositoryOwner: 'tobiaswaelde',
  startedAt: '2026-09-10T00:00:00.000Z',
  status: 'SUCCESS',
  url: 'https://github.com/tobiaswaelde/ezrepo/actions/runs/42',
  workflowName: 'ezRepo deployment',
};

/** Mock the authenticated shell and empty resource endpoints used by command-palette scenarios. */
async function mockCommandPaletteShell(page: Page, role: 'SYSTEM_ADMIN' | 'VIEWER'): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('ezrepo.access-token', 'playwright-access-token'));
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ json: { id: `playwright-${role.toLowerCase()}`, role, username: 'playwright' } }),
  );
  await page.route('**/api/v1/settings', (route) =>
    route.fulfill({ json: { dateTimeFormat: 'LOCALE_MEDIUM', workflowRunRetentionDays: 30 } }),
  );
  await page.route('**/api/v1/dashboard/awaiting-approval', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/dashboard/failures', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/dashboard/latest-runs', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/dashboard/repositories**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/dashboard/trend**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/dashboard/summary**', (route) =>
    route.fulfill({
      json: {
        awaitingApprovalCount: 0,
        completedCount: 0,
        medianDurationMs: null,
        queuedCount: 0,
        runningCount: 0,
        statuses: { cancelled: 0, failed: 0, skipped: 0, success: 0, unknown: 0 },
        successRate: 0,
      },
    }),
  );
  await page.route('**/api/v1/workflow-runs/needs-attention**', (route) => route.fulfill({ json: emptyPage }));
  await page.route(/\/api\/v1\/workflow-runs(?:\?.*)?$/, (route) => {
    const search = new URL(route.request().url()).searchParams.get('search');
    return route.fulfill({ json: { ...emptyPage, items: search === 'flow' ? [workflowRun] : [] } });
  });
  await page.route(/\/api\/v1\/repositories(?:\?.*)?$/, (route) => {
    const search = new URL(route.request().url()).searchParams.get('search');
    return route.fulfill({ json: { ...emptyPage, items: search === 'flow' ? [repository] : [] } });
  });
  await page.route(/\/api\/v1\/provider-accounts(?:\?.*)?$/, (route) => {
    const search = new URL(route.request().url()).searchParams.get('search');
    return route.fulfill({ json: { ...emptyPage, items: search === 'flow' ? [providerAccount] : [] } });
  });
  await page.route('**/api/v1/provider-accounts/authentication-options', (route) =>
    route.fulfill({ json: { oauthProviderTypes: [] } }),
  );
  await page.route('**/api/v1/repositories/repository-1', (route) => route.fulfill({ json: repository }));
  await page.route('**/api/v1/repositories/repository-1/workflow-filters', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/repositories/repository-1/memberships', (route) => route.fulfill({ json: [] }));
  await page.route(/\/api\/v1\/users(?:\?.*)?$/, (route) => route.fulfill({ json: emptyPage }));
}

test('opens globally, restores focus, supports keyboard navigation, and opens resource results', async ({
  page,
}, testInfo) => {
  await mockCommandPaletteShell(page, 'SYSTEM_ADMIN');
  await page.goto('/');

  const trigger = page.getByRole('button', { name: 'Open command palette' });
  const globalSearch = page.getByRole('combobox', { name: 'Search' });
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const paletteSearch = page.getByPlaceholder('Search or type a command');

  await trigger.click();
  await expect(palette).toBeVisible();
  await expect(paletteSearch).toBeFocused();
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('command-palette-desktop.png'),
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await expect(palette).not.toBeVisible();
  await expect(trigger).toBeFocused();

  await globalSearch.focus();
  await page.keyboard.press('Control+K');
  await expect(palette).not.toBeVisible();
  await globalSearch.press('Escape');

  await page.keyboard.press('Tab');
  await page.keyboard.press('Control+K');
  await expect(palette).toBeVisible();
  await expect(paletteSearch).toBeFocused();
  await expect(palette.getByRole('option', { name: 'Dashboard', exact: true })).toHaveAttribute('data-highlighted');
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => palette.locator('[data-highlighted]').allTextContents()).toEqual(['All runs']);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/workflow-runs$/);

  await page.keyboard.press('Control+K');
  await paletteSearch.fill('flow');
  await expect(palette.getByRole('option', { name: /ezRepo GitHub/ })).toBeVisible();
  await expect(palette.getByRole('option', { name: /ezRepo deployment/ })).toBeVisible();
  await palette
    .getByRole('option', { name: /tobiaswaelde\/ezrepo/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/repositories\?repository=repository-1$/);
  const repositoryDialog = page.getByRole('dialog', { name: 'tobiaswaelde/ezrepo' });
  await expect(repositoryDialog).toBeVisible();
  await repositoryDialog.getByRole('button', { name: 'Close' }).click();
  await expect(repositoryDialog).not.toBeVisible();

  await page.setViewportSize({ height: 844, width: 390 });
  await page.keyboard.press('Control+K');
  await expect(palette).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    .toBe(true);
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('command-palette-mobile.png'),
    fullPage: true,
  });
});

test('starts the existing provider creation dialog from an administrative command', async ({ page }) => {
  await mockCommandPaletteShell(page, 'SYSTEM_ADMIN');
  await page.goto('/');

  await page.getByRole('button', { name: 'Open command palette' }).click();
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await page.getByPlaceholder('Search or type a command').fill('Add provider account');
  await palette.getByRole('option', { name: /Add provider account/ }).click();

  const providerDialog = page.getByRole('dialog', { name: 'Add provider account' });
  await expect(providerDialog).toBeVisible();
  await expect(providerDialog.getByRole('button', { name: 'Verify and add provider' })).toBeEnabled();
});

test('starts the existing repository creation dialog from an administrative command', async ({ page }) => {
  await mockCommandPaletteShell(page, 'SYSTEM_ADMIN');
  await page.goto('/');

  await page.getByRole('button', { name: 'Open command palette' }).click();
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await page.getByPlaceholder('Search or type a command').fill('Add repositories');
  await palette.getByRole('option', { name: /Add repositories/ }).click();

  const repositoryDialog = page.getByRole('dialog', { name: 'Add repositories' });
  await expect(repositoryDialog).toBeVisible();
  await expect(
    repositoryDialog.getByText('Add and enable a provider account before adding a repository.'),
  ).toBeVisible();
});

test('hides administrative navigation and creation actions from viewers', async ({ page }) => {
  await mockCommandPaletteShell(page, 'VIEWER');
  let providerSearchRequests = 0;
  await page.unroute(/\/api\/v1\/provider-accounts(?:\?.*)?$/);
  await page.route(/\/api\/v1\/provider-accounts(?:\?.*)?$/, (route) => {
    providerSearchRequests += 1;
    return route.fulfill({ status: 403 });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Open command palette' }).click();
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await expect(palette.getByText('Provider accounts', { exact: true })).toHaveCount(0);
  await expect(palette.getByText('Add provider account', { exact: true })).toHaveCount(0);
  await expect(palette.getByText('Add repositories', { exact: true })).toHaveCount(0);

  await page.getByPlaceholder('Search or type a command').fill('provider');
  await expect(palette.getByText('No matching commands or resources found.')).toBeVisible();
  expect(providerSearchRequests).toBe(0);
});

for (const role of ['SYSTEM_ADMIN', 'VIEWER'] as const) {
  test(`shortcut dialog supports menu, focus, keyboard, and themes for ${role}`, async ({ page }, testInfo) => {
    await mockCommandPaletteShell(page, role);
    await page.goto('/');
    const userMenu = page.getByRole('button', { name: 'playwright', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await userMenu.click();
    const menuItem = page.getByRole('menuitem', { name: 'Keyboard shortcuts' });
    await menuItem.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('row')).toHaveCount(4);
    await expect(dialog.getByText('Open command palette')).toBeVisible();
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(close).toBeFocused();
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('shortcuts-desktop-dark.png') });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(userMenu).toBeFocused();
    await page.keyboard.press('?');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('?');
    await expect(dialog).not.toBeVisible();
    await expect(userMenu).toBeFocused();
    await page.getByRole('combobox', { name: 'Search' }).focus();
    await page.keyboard.press('?');
    await expect(dialog).not.toBeVisible();
    await page.keyboard.press('Escape');
    await userMenu.focus();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    });
    await page.keyboard.press('?');
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('shortcuts-mobile-light.png') });
    await close.click();
    await expect(dialog).not.toBeVisible();
    await expect(userMenu).toBeFocused();
  });
}

test('documents and runs Command+K on macOS and slash after navigation', async ({ page }) => {
  await mockCommandPaletteShell(page, 'VIEWER');
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }),
  );
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'playwright', exact: true });
  await menu.click();
  await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog.getByRole('row').filter({ hasText: 'Open command palette' })).toContainText('⌘');
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await page.keyboard.press('Meta+K');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'All runs', exact: true }).click();
  await page.getByRole('button', { name: 'Open command palette' }).focus();
  await page.keyboard.press('/');
  await expect(page.getByRole('combobox', { name: 'Search' })).toBeFocused();
  await page.keyboard.press('Escape');
  await menu.focus();
  await page.keyboard.press('?');
  await expect(dialog).toBeVisible();
});
