import { expect, test, type Page } from '@playwright/test';

const workflowRun = {
  completedAt: '2026-09-09T08:02:30.000Z',
  displayTitle: 'Build on main',
  durationMs: 150_000,
  id: 'run-1',
  providerCreatedAt: '2026-09-09T08:00:00.000Z',
  providerRunId: '42',
  providerType: 'GITHUB',
  repositoryId: 'repository-1',
  repositoryName: 'ezrepo',
  repositoryOwner: 'twaelde',
  startedAt: '2026-09-09T08:00:00.000Z',
  status: 'FAILED',
  url: 'https://github.com/tobiaswaelde/ezrepo/actions/runs/42',
  workflowName: 'Build',
};

/** Configure stable authenticated shell resources for needs-attention browser scenarios. */
async function mockApplication(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('ezrepo.access-token', 'playwright-access-token');
    window.localStorage.setItem(
      'table:workflow-runs-needs-attention:sort',
      JSON.stringify([{ desc: false, id: 'completedAt' }]),
    );
    window.localStorage.setItem(
      'table:workflow-runs-needs-attention:filtering',
      JSON.stringify({
        filters: [
          { field: 'repositoryId', id: 'repository-filter', operator: 'in', type: 'enum', value: ['repository-1'] },
          {
            field: 'repository.providerAccount.providerType',
            id: 'provider-filter',
            operator: 'in',
            type: 'enum',
            value: ['GITHUB'],
          },
          { field: 'durationMs', id: 'duration-filter', operator: 'gte', type: 'number', value: 90_000 },
          { field: 'status', id: 'status-filter', operator: 'in', type: 'enum', value: ['FAILED'] },
        ],
        operator: 'AND',
      }),
    );
  });
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
        items: [{ id: 'repository-1', name: 'ezrepo', owner: 'twaelde' }],
        meta: { hasNextPage: false, hasPrevPage: false, itemCount: 1, page: 1, pageCount: 1, perPage: 1_000 },
      },
    }),
  );
  await page.route('**/api/v1/dashboard/awaiting-approval', (route) =>
    route.fulfill({ json: Array.from({ length: 7 }, (_, index) => ({ id: `approval-${index}` })) }),
  );
}

test('browses, searches, sorts, filters, refreshes, and paginates the complete needs-attention set', async ({
  page,
}, testInfo) => {
  await mockApplication(page);
  const requestedUrls: string[] = [];
  let releaseInitialRequest: (() => void) | undefined;
  const initialRequest = new Promise<void>((resolve) => {
    releaseInitialRequest = resolve;
  });
  let failRequest = false;
  let holdInitialRequest = true;
  await page.route('**/api/v1/workflow-runs/needs-attention**', async (route) => {
    const url = new URL(route.request().url());
    requestedUrls.push(url.toString());
    const perPage = Number(url.searchParams.get('perPage') ?? '25');
    if (holdInitialRequest && perPage !== 1) {
      holdInitialRequest = false;
      await initialRequest;
    }
    if (failRequest) return route.abort('failed');
    const where = url.searchParams.get('where') ?? '';
    const pageNumber = Number(url.searchParams.get('page') ?? '1');
    const isEmptySearch = where.includes('missing');
    return route.fulfill({
      contentType: 'application/json',
      json: {
        items: isEmptySearch ? [] : [{ ...workflowRun, id: `run-${pageNumber}` }],
        meta: {
          hasNextPage: !isEmptySearch && pageNumber === 1,
          hasPrevPage: !isEmptySearch && pageNumber > 1,
          itemCount: isEmptySearch ? 0 : 26,
          page: pageNumber,
          pageCount: isEmptySearch ? 0 : 2,
          perPage,
        },
      },
    });
  });

  await page.goto('/workflow-runs/needs-attention');

  await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeAttached();
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(navigation.getByRole('button', { name: 'Workflow runs' })).toHaveAttribute('aria-expanded', 'true');
  const workflowRunNavigation = navigation.getByRole('region', { name: 'Workflow runs' });
  const awaitingApprovalLink = workflowRunNavigation.getByRole('link', { name: 'Awaiting approval' });
  const needsAttentionLink = workflowRunNavigation.getByRole('link', { name: 'Needs attention' });
  await expect(awaitingApprovalLink).toHaveAttribute('href', '/workflows/awaiting-approval');
  await expect(awaitingApprovalLink).not.toHaveAttribute('aria-current', 'page');
  await expect(awaitingApprovalLink.locator('[data-slot="linkTrailingBadge"]')).toHaveText('7');
  await expect(awaitingApprovalLink.locator('[data-slot="linkTrailingBadge"]')).toHaveClass(/text-warning/);
  await expect(needsAttentionLink).toHaveAttribute('href', '/workflow-runs/needs-attention');
  await expect(needsAttentionLink).toHaveAttribute('aria-current', 'page');
  await expect(needsAttentionLink.locator('[data-slot="linkTrailingBadge"]')).toHaveText('26');
  await expect(needsAttentionLink.locator('[data-slot="linkTrailingBadge"]')).toHaveClass(/text-error/);
  await page.getByPlaceholder('Search ezRepo').fill('approval');
  await expect(page.getByRole('link', { name: 'Awaiting approval' }).last()).toHaveAttribute(
    'href',
    '/workflows/awaiting-approval',
  );
  await page.keyboard.press('Escape');
  await page.locator('#main-content').focus();
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('needs-attention-loading.png'), fullPage: true });
  releaseInitialRequest?.();
  await expect(page.getByText('twaelde/ezrepo', { exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Title' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Workflow' })).toBeVisible();
  await expect(page.locator('tbody').getByText('Build on main', { exact: true })).toBeVisible();
  await expect(page.locator('tbody').getByText('Build', { exact: true })).toBeVisible();
  await expect(page.locator('#main-content').getByText('GitHub', { exact: true })).toBeVisible();
  await expect(page.getByText('Failed', { exact: true })).toBeVisible();
  await expect(page.getByText('2m 30s', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open in provider' })).toHaveAttribute('href', workflowRun.url);
  await expect(page.getByText('Showing 1–25 of 26')).toBeVisible();
  const initialUrl = new URL(requestedUrls.at(-1)!);
  expect(initialUrl.searchParams.get('fields')).toContain('workflowName');
  expect(initialUrl.searchParams.get('orderBy')).toBe(JSON.stringify([{ completedAt: 'asc' }]));
  expect(initialUrl.searchParams.get('where')).toContain('"repositoryId":{"in":["repository-1"]}');
  expect(initialUrl.searchParams.get('where')).toContain(
    '"repository":{"providerAccount":{"providerType":{"in":["GITHUB"]}}}',
  );
  expect(initialUrl.searchParams.get('where')).toContain('"durationMs":{"gte":90000}');
  expect(initialUrl.searchParams.get('where')).toContain('"status":{"in":["FAILED"]}');

  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => requestedUrls.some((url) => new URL(url).searchParams.get('page') === '2')).toBe(true);

  await page.getByPlaceholder('Search workflows or repositories').fill('missing');
  await expect(page.getByText('No workflows currently need attention.')).toBeVisible();
  await expect
    .poll(() => requestedUrls.some((url) => new URL(url).searchParams.get('where')?.includes('missing')))
    .toBe(true);

  failRequest = true;
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('Workflow runs that need attention could not be loaded.')).toBeVisible();

  failRequest = false;
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('No workflows currently need attention.')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('needs-attention.png'), fullPage: true });
});

for (const theme of ['light', 'dark'] as const) {
  test(`renders the needs-attention table responsively in ${theme} mode`, async ({ page }, testInfo) => {
    await page.addInitScript((colorMode) => window.localStorage.setItem('nuxt-color-mode', colorMode), theme);
    await mockApplication(page);
    await page.route('**/api/v1/workflow-runs/needs-attention**', (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.searchParams.get('perPage') !== '1')
        expect(requestUrl.searchParams.get('fields')).toContain('workflowName');
      return route.fulfill({
        json: {
          items: [workflowRun],
          meta: { hasNextPage: false, hasPrevPage: false, itemCount: 1, page: 1, pageCount: 1, perPage: 25 },
        },
      });
    });
    await page.setViewportSize({ height: 844, width: 390 });

    await page.goto('/workflow-runs/needs-attention');

    await expect(page.locator('html')).toHaveClass(new RegExp(theme));
    await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Title' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Workflow' })).toBeVisible();
    await expect(page.locator('tbody').getByText('Build on main', { exact: true })).toBeVisible();
    await expect(page.locator('tbody').getByText('Build', { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('Search workflows or repositories')).toBeVisible();
    const toolbar = page.locator('[data-page-toolbar]');
    await expect(toolbar.getByRole('button', { name: 'Refresh' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Sort' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Filter' })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: 'Table options' })).toBeVisible();
    await expect
      .poll(() =>
        toolbar.evaluate((element) => {
          const actions = element.querySelector(':scope > [data-slot="right"]')?.getBoundingClientRect();
          return Boolean(actions && actions.left >= 0 && actions.right <= document.documentElement.clientWidth);
        }),
      )
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`needs-attention-${theme}-mobile.png`), fullPage: true });
  });
}
