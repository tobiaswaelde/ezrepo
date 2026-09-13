import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

const jobs = [
  {
    attempt: 1,
    id: 'repository-running',
    lastError: null,
    progressCurrent: 7,
    progressPhase: 'PROCESSING_WORKFLOWS',
    progressTotal: 12,
    providerName: 'GitHub',
    providerType: 'GITHUB',
    repositoryName: 'ezrepo',
    repositoryOwner: 'tobiaswaelde',
    requestedAt: '2026-09-13T04:00:00.000Z',
    runAfter: '2026-09-13T04:00:00.000Z',
    scopes: ['WORKFLOWS', 'ISSUES', 'PULL_REQUESTS'],
    startedAt: '2026-09-13T04:00:01.000Z',
    status: 'RUNNING',
  },
  {
    attempt: 0,
    id: 'repository-idle',
    lastError: null,
    progressCurrent: null,
    progressPhase: null,
    progressTotal: null,
    providerName: 'Forgejo',
    providerType: 'FORGEJO',
    repositoryName: 'idle-repository',
    repositoryOwner: 'team',
    requestedAt: null,
    runAfter: null,
    scopes: ['WORKFLOWS', 'ISSUES', 'PULL_REQUESTS'],
    startedAt: null,
    status: 'IDLE',
  },
] as const;

async function mockJobsPage(page: Page, onQuery: () => void = () => undefined): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('ezrepo.access-token', 'playwright-access-token'));
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ json: { id: 'admin-id', role: 'SYSTEM_ADMIN', username: 'admin' } }),
  );
  await page.route('**/api/v1/settings', (route) =>
    route.fulfill({ json: { dateTimeFormat: 'LOCALE_MEDIUM', workflowRunRetentionDays: 90 } }),
  );
  await page.route('**/api/v1/dashboard/awaiting-approval', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/workflow-runs/needs-attention**', (route) =>
    route.fulfill({
      json: {
        items: [],
        meta: { hasNextPage: false, hasPrevPage: false, itemCount: 0, page: 1, pageCount: 0, perPage: 1 },
      },
    }),
  );
  await page.route('**/api/v1/version/latest', (route) => route.fulfill({ json: { latest: null } }));
  await page.route('**/api/v1/jobs/repository-sync/summary', (route) =>
    route.fulfill({ json: { failed: 0, idle: 1, pending: 0, running: 1, total: 2 } }),
  );
  await page.route(/\/api\/v1\/jobs\/repository-sync(?:\?.*)?$/, (route) => {
    onQuery();
    return route.fulfill({
      json: {
        items: jobs,
        meta: { hasNextPage: false, hasPrevPage: false, itemCount: 2, page: 1, pageCount: 1, perPage: 10 },
      },
    });
  });
}

test('shows available jobs, progress, start actions, and root navigation sections', async ({ page }) => {
  await mockJobsPage(page);
  let runAllCount = 0;
  let runRepositoryCount = 0;
  await page.route('**/api/v1/jobs/repository-sync/run', async (route) => {
    runAllCount += 1;
    await route.fulfill({ json: { queuedCount: 1 }, status: 202 });
  });
  await page.route('**/api/v1/jobs/repository-sync/repository-idle/run', async (route) => {
    runRepositoryCount += 1;
    await route.fulfill({ json: { queuedCount: 1 }, status: 202 });
  });

  await page.goto('/jobs');

  await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Repository synchronization' })).toBeVisible();
  await expect(page.getByText('tobiaswaelde/ezrepo')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Provider' })).toBeVisible();
  await expect(page.getByText('Processing workflows: 7/12')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: '58%' })).toHaveAttribute('aria-valuenow', '7');
  await expect(page.getByText('team/idle-repository')).toBeVisible();
  await expect(page.getByText('Overview', { exact: true })).toBeVisible();
  await expect(page.getByText('Operations', { exact: true })).toBeVisible();
  await expect(page.getByText('Administration', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Provider accounts' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Users' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Administration' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Run all' }).click();
  await expect.poll(() => runAllCount).toBe(1);
  await page.getByRole('row').filter({ hasText: 'team/idle-repository' }).getByRole('button', { name: 'Run' }).click();
  await expect.poll(() => runRepositoryCount).toBe(1);

  await page.screenshot({ path: resolve(process.cwd(), '../../docs/public/screenshots/jobs.png'), fullPage: true });

  await page.setViewportSize({ height: 844, width: 390 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    .toBe(true);
});

test('polls every five seconds only while the jobs page is mounted', async ({ page }) => {
  let queryCount = 0;
  await mockJobsPage(page, () => {
    queryCount += 1;
  });

  await page.goto('/jobs');
  await expect.poll(() => queryCount).toBeGreaterThanOrEqual(1);
  const initialQueryCount = queryCount;
  await expect.poll(() => queryCount, { timeout: 6_000 }).toBeGreaterThan(initialQueryCount);

  await page.goto('/repositories');
  const unmountedQueryCount = queryCount;
  await page.waitForTimeout(5_250);
  expect(queryCount).toBe(unmountedQueryCount);
});
