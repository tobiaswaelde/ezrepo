import { resolve } from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';

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

/** Measure foreground contrast against the first opaque ancestor background. */
async function contrastRatio(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas color parsing is unavailable.');
    const rgba = (value: string): [number, number, number, number] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(0, 0, 1, 1).data;
      return [red, green, blue, alpha / 255];
    };
    const foreground = rgba(getComputedStyle(element).color);
    let background: [number, number, number, number] = [255, 255, 255, 1];
    for (let current: Element | null = element; current; current = current.parentElement) {
      const candidate = rgba(getComputedStyle(current).backgroundColor);
      if (candidate[3] === 1) {
        background = candidate;
        break;
      }
    }
    const luminance = ([red, green, blue]: [number, number, number, number]): number => {
      const channel = (value: number): number => {
        const normalized = value / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
    };
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    return (
      (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
      (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    );
  });
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
  await expect(page.getByText('Update available', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open changelog: Update available' })).toBeVisible();
  const workflowRunNavigation = page
    .getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('region', { name: 'Workflow runs' });
  await expect(workflowRunNavigation.locator('[data-slot="linkTrailingBadge"]')).toHaveCount(0);
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

test('keeps table navigation accessible at desktop and narrow widths', async ({ page }, testInfo) => {
  await mockApplication(page);
  await page.goto('/workflow-runs');
  await expect(page.getByText('No workflow runs are available.')).toBeVisible();

  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  const unnamedButtons = await page.locator('[data-page-shell] button:visible').evaluateAll((buttons) =>
    buttons
      .filter((button) => {
        const labelledBy = button.getAttribute('aria-labelledby');
        return !(
          button.textContent?.trim() ||
          button.getAttribute('aria-label')?.trim() ||
          button.getAttribute('title')?.trim() ||
          (labelledBy && document.getElementById(labelledBy)?.textContent?.trim())
        );
      })
      .map((button) => button.outerHTML),
  );
  expect(unnamedButtons).toEqual([]);
  expect(await contrastRatio(page.getByText('No workflow runs are available.'))).toBeGreaterThanOrEqual(4.5);

  await page.setViewportSize({ height: 844, width: 390 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    .toBe(true);
  const tableScroller = page.locator('table').locator('..');
  await expect.poll(() => tableScroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  const titleHeader = await page.getByRole('columnheader', { name: 'Title' }).boundingBox();
  const workflowHeader = await page.getByRole('columnheader', { name: 'Workflow' }).boundingBox();
  expect(titleHeader).not.toBeNull();
  expect(workflowHeader).not.toBeNull();
  expect(titleHeader!.x + titleHeader!.width).toBeLessThanOrEqual(workflowHeader!.x);
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('workflow-runs-narrow.png'),
    fullPage: true,
  });
});

test('refreshes and hides attention badges after navigation', async ({ page }) => {
  await mockApplication(page);
  let awaitingApprovalCount = 2;
  let needsAttentionCount = 3;
  await page.route('**/api/v1/dashboard/awaiting-approval', (route) =>
    route.fulfill({ json: Array.from({ length: awaitingApprovalCount }, (_, index) => ({ id: `run-${index}` })) }),
  );
  await page.route(/\/api\/v1\/workflow-runs\/needs-attention(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        ...emptyPage,
        meta: { ...emptyPage.meta, itemCount: needsAttentionCount },
      },
    }),
  );

  await page.goto('/');
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  const workflowRuns = navigation.getByRole('region', { name: 'Workflow runs' });
  await expect(workflowRuns.getByRole('link', { name: 'Awaiting approval' })).toContainText('2');
  await expect(workflowRuns.getByRole('link', { name: 'Needs attention' })).toContainText('3');

  awaitingApprovalCount = 0;
  needsAttentionCount = 0;
  await navigation.getByRole('link', { name: 'Channels' }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(workflowRuns.locator('[data-slot="linkTrailingBadge"]')).toHaveCount(0);
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
