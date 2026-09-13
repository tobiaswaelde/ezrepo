import { expect, test, type Page } from '@playwright/test';

const issue = {
  assignees: [{ avatarUrl: null, displayName: 'Alex Example', url: null, username: 'alex' }],
  author: { avatarUrl: null, displayName: 'Taylor Example', url: null, username: 'taylor' },
  body: '## Reproduction\n\n<script>window.__unsafe = true</script>\n\n[unsafe](javascript:alert(1))',
  closedAt: null,
  id: 'issue-1',
  labels: [
    { color: '#d73a4a', description: 'Defect', name: 'Bug' },
    { color: '#0052cc', description: null, name: 'Priority: High' },
  ],
  milestone: 'v1.0',
  number: '204',
  providerCreatedAt: '2026-09-01T08:00:00.000Z',
  providerType: 'GITHUB',
  providerUpdatedAt: '2026-09-12T08:00:00.000Z',
  repositoryId: 'repository-1',
  repositoryName: 'ezrepo',
  repositoryOwner: 'tobiaswaelde',
  state: 'OPEN',
  title: 'Track provider issues',
  url: 'https://github.com/tobiaswaelde/ezrepo/issues/204',
};

const pullRequest = {
  ...issue,
  body: 'Adds merge request tracking.',
  draft: true,
  id: 'pull-request-1',
  mergedAt: null,
  number: '213',
  providerType: 'GITLAB',
  sourceBranch: 'feature/work-items',
  targetBranch: 'main',
  title: 'Track merge requests',
  url: 'https://gitlab.example.test/ezrepo/-/merge_requests/213',
  workflowApprovalRequired: true,
  workflowStatus: 'FAILED',
};

async function mockShell(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('ezrepo.access-token', 'playwright-access-token'));
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ json: { id: 'viewer', role: 'VIEWER', username: 'viewer' } }),
  );
  await page.route('**/api/v1/settings', (route) =>
    route.fulfill({ json: { dateTimeFormat: 'LOCALE_MEDIUM', workflowRunRetentionDays: 90 } }),
  );
  await page.route('**/api/v1/health', (route) =>
    route.fulfill({ json: { api: 'ok', database: 'ok', providers: [], status: 'ok' } }),
  );
  await page.route(/\/api\/v1\/repositories(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: [{ id: 'repository-1', name: 'ezrepo', owner: 'tobiaswaelde' }],
        meta: { hasNextPage: false, hasPrevPage: false, itemCount: 1, page: 1, pageCount: 1, perPage: 1_000 },
      },
    }),
  );
}

async function expectFullPageShell(page: Page): Promise<void> {
  await expect(page.locator('#main-content')).toHaveClass(/overflow-hidden/);
}

test('filters issues by every selected label and updated range, then renders sanitized provider Markdown', async ({
  page,
}, testInfo) => {
  await mockShell(page);
  const requestedUrls: string[] = [];
  await page.route('**/api/v1/issues/filter-options', (route) =>
    route.fulfill({
      json: { assignees: ['alex'], authors: ['taylor'], labels: ['Bug', 'Priority: High'], milestones: ['v1.0'] },
    }),
  );
  await page.route('**/api/v1/issues/summary', (route) =>
    route.fulfill({ json: { assigned: 1, open: 1, recentlyUpdated: 1, stale: 0 } }),
  );
  await page.route(/\/api\/v1\/issues(?:\?.*)?$/, (route) => {
    requestedUrls.push(route.request().url());
    return route.fulfill({
      json: {
        items: [{ ...issue, body: undefined }],
        meta: { hasNextPage: false, hasPrevPage: false, itemCount: 1, page: 1, pageCount: 1, perPage: 25 },
      },
    });
  });
  await page.route('**/api/v1/issues/issue-1', (route) => route.fulfill({ json: issue }));

  await page.goto('/issues');
  await expectFullPageShell(page);
  const issueBreadcrumbs = page.locator('[data-page-toolbar]').first();
  await expect(issueBreadcrumbs.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/');
  await expect(issueBreadcrumbs.getByText('Issues', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Issues' })).toBeVisible();
  await expect(page.getByText('Track provider issues')).toBeVisible();
  await page.getByRole('button', { name: 'Labels' }).click();
  await page.getByRole('option', { name: 'Bug' }).click();
  await page.getByRole('option', { name: 'Priority: High' }).click();
  await page.keyboard.press('Escape');
  await page.getByLabel('Updated from').fill('2026-09-01');
  await page.getByLabel('Updated to').fill('2026-09-13');
  await expect
    .poll(() => new URL(requestedUrls.at(-1)!).searchParams.get('where') ?? '')
    .toContain('2026-09-13T23:59:59.999Z');
  const where = new URL(requestedUrls.at(-1)!).searchParams.get('where') ?? '';
  expect(where).toContain('bug');
  expect(where).toContain('priority: high');
  expect(where).toContain('2026-09-01T00:00:00.000Z');
  expect(where).toContain('2026-09-13T23:59:59.999Z');

  await page.getByRole('link', { name: 'Track provider issues' }).click();
  await expectFullPageShell(page);
  const issueDetailBreadcrumbs = page.locator('[data-page-toolbar]').first();
  await expect(issueDetailBreadcrumbs.getByRole('link', { name: 'Issues' })).toHaveAttribute('href', '/issues');
  await expect(issueDetailBreadcrumbs.getByText('#204', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Track provider issues' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Reproduction' })).toBeVisible();
  await expect(page.locator('script').filter({ hasText: 'window.__unsafe' })).toHaveCount(0);
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => '__unsafe' in window)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('issue-detail.png'), fullPage: true });
});

test('renders GitLab pull requests as merge requests with independent workflow signals', async ({ page }, testInfo) => {
  await mockShell(page);
  await page.route('**/api/v1/pull-requests/filter-options', (route) =>
    route.fulfill({ json: { assignees: ['alex'], authors: ['taylor'], labels: ['Bug'], milestones: [] } }),
  );
  await page.route('**/api/v1/pull-requests/summary', (route) =>
    route.fulfill({ json: { drafts: 1, failedWorkflows: 1, open: 1, workflowApprovalRequired: 1 } }),
  );
  await page.route(/\/api\/v1\/pull-requests(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: [{ ...pullRequest, body: undefined }],
        meta: { hasNextPage: false, hasPrevPage: false, itemCount: 1, page: 1, pageCount: 1, perPage: 25 },
      },
    }),
  );
  await page.route('**/api/v1/pull-requests/pull-request-1', (route) => route.fulfill({ json: pullRequest }));

  await page.goto('/pull-requests');
  await expectFullPageShell(page);
  const pullRequestBreadcrumbs = page.locator('[data-page-toolbar]').first();
  await expect(pullRequestBreadcrumbs.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/');
  await expect(pullRequestBreadcrumbs.getByText('Pull requests', { exact: true })).toBeVisible();
  await expect(page.getByText('Failed', { exact: true })).toBeVisible();
  await expect(page.getByRole('table').getByText('Workflow approval required', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Track merge requests' }).click();
  await expectFullPageShell(page);
  const pullRequestDetailBreadcrumbs = page.locator('[data-page-toolbar]').first();
  await expect(pullRequestDetailBreadcrumbs.getByRole('link', { name: 'Pull requests' })).toHaveAttribute(
    'href',
    '/pull-requests',
  );
  await expect(pullRequestDetailBreadcrumbs.getByText('#213', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open merge request' })).toHaveAttribute('href', pullRequest.url);
  await expect(page.getByText('feature/work-items')).toBeVisible();
  await expect(page.getByText('main', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('merge-request-detail.png'), fullPage: true });
});

for (const theme of ['light', 'dark'] as const) {
  test(`keeps work-item overview responsive in ${theme} mode`, async ({ page }, testInfo) => {
    await page.addInitScript((colorMode) => window.localStorage.setItem('nuxt-color-mode', colorMode), theme);
    await mockShell(page);
    await page.route('**/api/v1/issues/filter-options', (route) =>
      route.fulfill({ json: { assignees: [], authors: [], labels: ['Bug'], milestones: [] } }),
    );
    await page.route('**/api/v1/issues/summary', (route) =>
      route.fulfill({ json: { assigned: 1, open: 1, recentlyUpdated: 1, stale: 0 } }),
    );
    await page.route(/\/api\/v1\/issues(?:\?.*)?$/, (route) =>
      route.fulfill({
        json: {
          items: [{ ...issue, body: undefined }],
          meta: { hasNextPage: false, hasPrevPage: false, itemCount: 1, page: 1, pageCount: 1, perPage: 25 },
        },
      }),
    );
    await page.setViewportSize({ height: 844, width: 390 });

    await page.goto('/issues');

    await expect(page.locator('html')).toHaveClass(new RegExp(theme));
    await expect(page.getByText('Track provider issues')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`issues-${theme}-mobile.png`), fullPage: true });
  });
}
