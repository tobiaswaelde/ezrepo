import { expect, test, type Page } from '@playwright/test';

const accessToken = 'playwright-access-token';
const dashboardRun = {
  awaitingApproval: false,
  completedAt: '2026-08-27T10:02:00.000Z',
  displayTitle: 'CI',
  durationMs: 120_000,
  id: 'run-1',
  provider: { displayName: 'GitHub', id: 'provider-1', providerType: 'GITHUB' },
  providerCreatedAt: '2026-08-27T10:00:00.000Z',
  providerRunId: '101',
  reviewUrl: null,
  repository: { id: 'repository-1', name: 'ezrepo', owner: 'ezrepo', url: 'https://github.com/ezrepo/ezrepo' },
  startedAt: '2026-08-27T10:00:00.000Z',
  status: 'FAILED',
  url: 'https://github.com/ezrepo/ezrepo/actions/runs/101',
  workflowName: 'CI',
};
const dashboardSummary = {
  awaitingApprovalCount: 2,
  completedCount: 2,
  medianDurationMs: 90_000,
  queuedCount: 1,
  runningCount: 1,
  statuses: { cancelled: 0, failed: 1, skipped: 0, success: 1, unknown: 0 },
  successRate: 50,
  totalRunDurationMs: 5_400_000,
};
const repositoryHealth = [
  {
    completedCount: 2,
    failedCount: 1,
    medianDurationMs: 90_000,
    repository: dashboardRun.repository,
    successRate: 50,
  },
];

/** Configure the current authenticated user and dashboard endpoint responses. */
async function mockDashboard(page: Page, role: 'SYSTEM_ADMIN' | 'VIEWER'): Promise<void> {
  await page.addInitScript((token) => window.localStorage.setItem('ezrepo.access-token', token), accessToken);
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({ contentType: 'application/json', json: { id: 'playwright', role, username: 'playwright' } });
  });
  await page.route('**/api/v1/issues/summary', (route) =>
    route.fulfill({ json: { assigned: 3, open: 8, recentlyUpdated: 5, stale: 2 } }),
  );
  await page.route('**/api/v1/pull-requests/summary', (route) =>
    route.fulfill({ json: { drafts: 1, failedWorkflows: 2, open: 4, workflowApprovalRequired: 1 } }),
  );
}

test('redirects unauthenticated visitors to sign-in', async ({ page }) => {
  await page.route('**/api/v1/auth/setup-status', (route) => route.fulfill({ json: { initialized: true } }));
  await page.goto('/');

  await expect(page).toHaveURL(/\/auth\/signin$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('hides system administration navigation from viewers', async ({ page }) => {
  await mockDashboard(page, 'VIEWER');
  await page.route('**/api/v1/dashboard/failures', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/dashboard/latest-runs', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/dashboard/repositories**', (route) => route.fulfill({ json: [] }));
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
  await page.route('**/api/v1/dashboard/trend**', (route) => route.fulfill({ json: [] }));

  await page.goto('/');

  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByText('Administration', { exact: true })).not.toBeVisible();
  await expect(page.getByText('No workflows are currently failing.')).toBeVisible();
  await expect(page.getByText('No workflow runs are available yet.')).toBeVisible();
  await expect(page.getByText('No repository health data is available for this period.')).toBeVisible();
});

test('renders dashboard values, reloads for range filters, and presents request errors', async ({ page }, testInfo) => {
  await mockDashboard(page, 'SYSTEM_ADMIN');
  let failDashboardRequest = false;
  const repositoryUrls: string[] = [];
  const summaryUrls: string[] = [];
  const trendUrls: string[] = [];
  const pullRequestUrls: string[] = [];
  await page.route('**/api/v1/dashboard/failures', (route) =>
    failDashboardRequest
      ? route.abort('failed')
      : route.fulfill({ contentType: 'application/json', json: [dashboardRun] }),
  );
  await page.route('**/api/v1/dashboard/latest-runs', (route) =>
    route.fulfill({ contentType: 'application/json', json: [dashboardRun] }),
  );
  await page.route('**/api/v1/dashboard/repositories**', (route) => {
    repositoryUrls.push(route.request().url());
    return route.fulfill({ contentType: 'application/json', json: repositoryHealth });
  });
  await page.route('**/api/v1/dashboard/summary**', (route) => {
    summaryUrls.push(route.request().url());
    return route.fulfill({ contentType: 'application/json', json: dashboardSummary });
  });
  await page.route('**/api/v1/dashboard/trend**', (route) => {
    trendUrls.push(route.request().url());
    return route.fulfill({
      contentType: 'application/json',
      json: [
        { bucketStart: '2026-08-26T00:00:00.000Z', errorCount: 1, successCount: 2 },
        { bucketStart: '2026-08-27T00:00:00.000Z', errorCount: 1, successCount: 1 },
      ],
    });
  });
  await page.route('**/api/v1/pull-requests/filter-options', (route) =>
    route.fulfill({ json: { assignees: [], authors: [], labels: [], milestones: [] } }),
  );
  await page.route(/\/api\/v1\/pull-requests(?:\?.*)?$/, (route) => {
    pullRequestUrls.push(route.request().url());
    return route.fulfill({
      json: {
        items: [],
        meta: { hasNextPage: false, hasPrevPage: false, itemCount: 0, page: 1, pageCount: 0, perPage: 25 },
      },
    });
  });
  await page.route(/\/api\/v1\/repositories(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: [],
        meta: { hasNextPage: false, hasPrevPage: false, itemCount: 0, page: 1, pageCount: 0, perPage: 1_000 },
      },
    }),
  );

  await page.goto('/');

  await expect(page.getByRole('link', { name: 'Provider accounts' })).toBeVisible();
  await expect(page.getByText('CI', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Failed', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('2m 0s', { exact: true })).toBeVisible();
  await expect(page.getByText('Success rate')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Work overview' }).getByText('Open issues')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Work overview' }).getByText('8', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Workflow health summary' }).getByText('Awaiting approval', { exact: true }),
  ).toBeVisible();
  const workflowSummary = page.getByRole('region', { name: 'Workflow health summary' });
  await expect(workflowSummary.getByRole('link').filter({ hasText: 'Success rate' })).toHaveAttribute(
    'href',
    '/workflow-runs',
  );
  await expect(workflowSummary.getByRole('link').filter({ hasText: 'Failing now' })).toHaveAttribute(
    'href',
    '/workflow-runs/needs-attention',
  );
  await expect(workflowSummary.getByRole('link').filter({ hasText: 'Awaiting approval' })).toHaveAttribute(
    'href',
    '/workflows/awaiting-approval',
  );
  await expect(workflowSummary.getByRole('link').filter({ hasText: 'Median duration' })).toHaveAttribute(
    'href',
    '/workflow-runs',
  );
  await expect(workflowSummary.getByRole('link').filter({ hasText: 'Total runtime' })).toHaveAttribute(
    'href',
    '/workflow-runs',
  );
  await expect(workflowSummary.getByRole('link').filter({ hasText: 'Active runs' })).toHaveAttribute(
    'href',
    '/workflow-runs?preset=active',
  );
  const workSummary = page.getByRole('region', { name: 'Work overview' });
  await expect(workSummary.getByRole('link').filter({ hasText: 'Open issues' })).toHaveAttribute(
    'href',
    '/issues?preset=open',
  );
  await expect(workSummary.getByRole('link').filter({ hasText: 'Stale for 30 days' })).toHaveAttribute(
    'href',
    '/issues?preset=stale',
  );
  await expect(workSummary.getByRole('link').filter({ hasText: 'Open pull requests' })).toHaveAttribute(
    'href',
    '/pull-requests?preset=open',
  );
  await expect(workSummary.getByRole('link').filter({ hasText: 'Workflow approval required' })).toHaveAttribute(
    'href',
    '/pull-requests?preset=approval-required',
  );
  await page.screenshot({ path: testInfo.outputPath('dashboard-kpi-links.png'), fullPage: true });
  await expect(page.getByRole('region', { name: 'Workflow health summary' }).getByText('50 %')).toBeVisible();
  await expect(page.getByText('Total runtime')).toBeVisible();
  await expect(page.getByText('90 min', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Status distribution' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Repository health' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/workflow-runs/needs-attention');
  const trendChart = page.getByRole('img', { name: /3 successful and 2 failed runs/ });
  await expect(trendChart).toBeVisible();
  await expect(trendChart.locator('[data-series="success"]')).toHaveCount(2);
  await expect(trendChart.locator('[data-series="error"]')).toHaveCount(2);
  const stackedBars = await trendChart.locator('[data-series]').evaluateAll((segments) =>
    segments.map((segment) => ({
      height: Number(segment.getAttribute('height')),
      series: segment.getAttribute('data-series'),
      width: Number(segment.getAttribute('width')),
      x: Number(segment.getAttribute('x')),
      y: Number(segment.getAttribute('y')),
    })),
  );
  expect(stackedBars).toHaveLength(4);
  expect(stackedBars[0]).toMatchObject({
    series: 'success',
    width: stackedBars[2]?.width,
    x: stackedBars[2]?.x,
  });
  expect(stackedBars[1]).toMatchObject({
    series: 'success',
    width: stackedBars[3]?.width,
    x: stackedBars[3]?.x,
  });
  expect(stackedBars[2]?.y).toBeCloseTo((stackedBars[0]?.y ?? 0) - (stackedBars[2]?.height ?? 0));
  expect(stackedBars[3]?.y).toBeCloseTo((stackedBars[1]?.y ?? 0) - (stackedBars[3]?.height ?? 0));
  const latestRunsTable = page.locator('table');
  await expect(latestRunsTable.getByRole('link', { name: 'CI', exact: true })).toHaveCount(0);
  const latestRunLink = latestRunsTable.getByRole('link', { name: 'Open in provider' });
  await expect(latestRunLink).toHaveAttribute('href', 'https://github.com/ezrepo/ezrepo/actions/runs/101');
  await latestRunLink.hover();
  await expect(page.locator('[data-slot="content"][data-side]').filter({ hasText: 'Open in provider' })).toBeVisible();
  await expect(latestRunsTable).not.toContainText(/\b(?:AM|PM)\b/);

  await page.getByRole('combobox', { name: 'Dashboard period' }).click();
  await page.getByRole('option', { name: 'Last 7 days' }).click();
  await expect.poll(() => trendUrls.some((url) => new URL(url).searchParams.get('bucket') === 'hour')).toBe(true);
  await expect.poll(() => summaryUrls.length).toBe(2);
  await expect.poll(() => repositoryUrls.length).toBe(2);

  failDashboardRequest = true;
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('Some dashboard data is unavailable')).toBeVisible();
  await expect(page.getByText('Available sections remain visible. Refresh to retry the missing data.')).toBeVisible();
  await expect(page.getByText('CI', { exact: true }).first()).toBeVisible();

  await page.setViewportSize({ height: 844, width: 390 });
  await expect(page.getByRole('heading', { name: 'Status distribution' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Repository health' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    .toBe(true);

  await page.evaluate(() =>
    window.localStorage.setItem(
      'table:pull-requests:filtering',
      JSON.stringify({
        filters: [{ field: 'state', id: 'saved-state', operator: 'in', type: 'enum', value: ['CLOSED'] }],
        operator: 'AND',
      }),
    ),
  );
  const openPullRequestsLink = workSummary.getByRole('link').filter({ hasText: 'Open pull requests' });
  await openPullRequestsLink.focus();
  await expect(openPullRequestsLink).toBeFocused();
  await openPullRequestsLink.click();

  await expect(page).toHaveURL(/\/pull-requests\?preset=open$/);
  await expect(page.getByRole('button', { name: 'Open pull requests' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('pull-request-open-preset.png'), fullPage: true });
  await expect.poll(() => new URL(pullRequestUrls.at(-1)!).searchParams.get('where') ?? '').toContain('OPEN');
  expect(new URL(pullRequestUrls.at(-1)!).searchParams.get('where') ?? '').not.toContain('CLOSED');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(window.localStorage.getItem('table:pull-requests:filtering') ?? '{}')))
    .toMatchObject({ filters: [{ field: 'state', value: ['OPEN'] }], operator: 'AND' });

  await page.getByRole('button', { name: 'Open pull requests' }).click();
  await expect(page).toHaveURL(/\/pull-requests$/);
  await expect.poll(() => new URL(pullRequestUrls.at(-1)!).searchParams.get('where')).toBeNull();
});
