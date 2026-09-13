import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

const emptyPage = {
  items: [],
  meta: { hasNextPage: false, hasPrevPage: false, itemCount: 0, page: 1, pageCount: 0, perPage: 25 },
};

/** Mock authenticated application resources used across the page-shell scenarios. */
async function mockApplication(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('ezrepo.access-token', 'playwright-access-token'));
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      json: {
        avatarUpdatedAt: null,
        firstName: 'Vera',
        id: 'administrator-id',
        lastName: 'Admin',
        role: 'SYSTEM_ADMIN',
        username: 'vera',
      },
    }),
  );
  await page.route(/\/api\/v1\/settings$/, (route) =>
    route.fulfill({ json: { dateTimeFormat: 'LOCALE_MEDIUM', workflowRunRetentionDays: 90 } }),
  );
  await page.route('**/api/v1/health', (route) =>
    route.fulfill({ json: { api: 'ok', database: 'ok', providers: [], status: 'ok' } }),
  );
  await page.route('**/api/v1/version/latest', (route) => route.fulfill({ json: { latest: '999.0.0' } }));
  await page.route('**/api/v1/dashboard/failures', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/dashboard/latest-runs', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/dashboard/awaiting-approval', (route) => route.fulfill({ json: [] }));
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
        totalRunDurationMs: 0,
      },
    }),
  );
  await page.route(/\/api\/v1\/(?:provider-accounts|repositories|users|workflow-runs)(?:\?.*)?$/, (route) =>
    route.fulfill({ json: emptyPage }),
  );
  await page.route(/\/api\/v1\/workflow-runs\/needs-attention(?:\?.*)?$/, (route) =>
    route.fulfill({ json: emptyPage }),
  );
  await page.route('**/api/v1/repositories/repository-1', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        id: 'repository-1',
        lastSyncAt: null,
        name: 'ezrepo',
        owner: 'tobiaswaelde',
        providerAccountId: 'provider-1',
        url: 'https://github.com/tobiaswaelde/ezrepo',
        workflowRunRetentionDays: 90,
      },
    }),
  );
  await page.route('**/api/v1/repositories/repository-1/workflow-filters', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/repositories/repository-1/memberships', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/notification-channels', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/notification-channels/query**', (route) => route.fulfill({ json: emptyPage }));
  await page.route('**/api/v1/notification-channels/manageable-repositories', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/notification-deliveries', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/notification-deliveries/query**', (route) => route.fulfill({ json: emptyPage }));
  await page.route('**/api/v1/browser-push', (route) =>
    route.fulfill({ json: { available: false, publicKey: null, subscriptionCount: 0 } }),
  );
}

test('uses the shared page shell without introductory banners', async ({ page }) => {
  await mockApplication(page);
  await page.goto('/');
  await expect(page.locator('[data-page-shell]')).toBeVisible();
  await expect(page.locator('[data-page-toolbar]')).toHaveCount(1);
  await expect(page.locator('[data-page-introduction]')).toHaveCount(0);
  await expect(page.locator('[data-intro-banner-id]')).toHaveCount(0);
  await expect(page.locator('[data-sidebar-footer]')).toBeVisible();
  await expect(page.getByRole('link', { name: 'ezRepo' }).locator('img')).toHaveAttribute('src', '/logo.svg');
  await expect(page.locator('link[rel="icon"][href="/favicon.svg"]')).toHaveAttribute('href', '/favicon.svg');
  await expect(page.getByRole('link', { name: 'GitHub' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Documentation' })).toBeVisible();
  await expect(page.locator('[data-update-indicator]')).toBeVisible();
  await expect(page.getByLabel('Collapse sidebar')).toBeVisible();
  await page.screenshot({
    path: resolve(process.cwd(), '../../docs/public/screenshots/dashboard.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Open changelog' }).click();
  await expect(page.getByRole('dialog', { name: 'Changelog' })).toBeVisible();

  for (const [path, name] of [
    ['/workflow-runs', 'workflow-runs'],
    ['/repositories', 'repositories'],
    ['/notifications', 'notifications'],
    ['/admin/providers', 'provider-accounts'],
    ['/admin/settings', 'settings'],
  ]) {
    await page.goto(path);
    await expect(page.locator('[data-page-shell]')).toBeVisible();
    await page.screenshot({
      path: resolve(process.cwd(), `../../docs/public/screenshots/${name}.png`),
      fullPage: true,
    });
  }
});

test('queues workflow retrieval from the repository details dialog', async ({ page }) => {
  await mockApplication(page);
  let syncRequested = false;
  await page.route('**/api/v1/repositories/repository-1/sync', async (route) => {
    syncRequested = true;
    await route.fulfill({ status: 202 });
  });

  await page.goto('/repositories?repository=repository-1');

  const syncButton = page.getByRole('button', { name: 'Fetch workflow runs' });
  await expect(syncButton).toBeVisible();
  await syncButton.click();
  await expect.poll(() => syncRequested).toBe(true);
  await expect(page.getByText('Workflow runs were queued for retrieval.')).toBeVisible();
});
