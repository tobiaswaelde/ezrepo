import { expect, test, type Page, type Route } from '@playwright/test';

const emptyPage = {
  items: [],
  meta: { hasNextPage: false, hasPrevPage: false, itemCount: 0, page: 1, pageCount: 0, perPage: 20 },
};

/** Mock authenticated shell requests so search behavior can be exercised without a live API. */
async function mockApplicationShell(page: Page, role: 'SYSTEM_ADMIN' | 'VIEWER'): Promise<void> {
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
}

/** Delay obsolete queries long enough for the replacement generation to finish first. */
async function delayObsoleteSearch(route: Route): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 600));
  try {
    await route.fulfill({ json: emptyPage });
  } catch {
    // The browser may already have cancelled the obsolete request, which is the desired outcome.
  }
}

test('groups authorized global results and keeps stale responses from replacing a newer query', async ({
  page,
}, testInfo) => {
  await mockApplicationShell(page, 'SYSTEM_ADMIN');
  const requestedSearchUrls: string[] = [];
  await page.route(/\/api\/v1\/provider-accounts(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const search = url.searchParams.get('search');
    if (!search) return route.fulfill({ json: emptyPage });
    requestedSearchUrls.push(url.toString());
    if (search === 'obsolete') return delayObsoleteSearch(route);
    return route.fulfill({
      json: {
        ...emptyPage,
        items: [
          {
            baseUrl: null,
            displayName: 'ezRepo GitHub',
            enabled: true,
            id: 'provider-1',
            lastSyncAt: null,
            providerType: 'GITHUB',
          },
        ],
      },
    });
  });
  await page.route(/\/api\/v1\/repositories(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const search = url.searchParams.get('search');
    if (!search) return route.fulfill({ json: emptyPage });
    requestedSearchUrls.push(url.toString());
    if (search === 'obsolete') return delayObsoleteSearch(route);
    return route.fulfill({
      json: {
        ...emptyPage,
        items: [
          {
            enabled: true,
            id: 'repository-1',
            lastSyncAt: null,
            name: 'ezrepo',
            owner: 'tobiaswaelde',
            providerAccountId: 'provider-1',
            url: 'https://github.com/tobiaswaelde/ezrepo',
            workflowRunRetentionDays: null,
          },
        ],
      },
    });
  });
  await page.route(/\/api\/v1\/workflow-runs(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const search = url.searchParams.get('search');
    requestedSearchUrls.push(url.toString());
    if (search === 'obsolete') return delayObsoleteSearch(route);
    return route.fulfill({
      json: {
        ...emptyPage,
        items: [
          {
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
          },
        ],
      },
    });
  });
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
        workflowRunRetentionDays: null,
      },
    }),
  );
  await page.route('**/api/v1/repositories/repository-1/workflow-filters', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/repositories/repository-1/memberships', (route) => route.fulfill({ json: [] }));
  await page.route(/\/api\/v1\/users(?:\?.*)?$/, (route) => route.fulfill({ json: emptyPage }));

  await page.goto('/');
  const search = page.getByRole('combobox', { name: 'Search' });
  await search.fill('obsolete');
  await expect.poll(() => requestedSearchUrls.filter((url) => url.includes('search=obsolete')).length).toBe(3);
  await search.fill('flow');

  const results = page.getByRole('listbox', { name: 'Search results' });
  await expect(results.getByText('Provider accounts', { exact: true })).toBeVisible();
  await expect(results.getByRole('option', { name: 'ezRepo GitHub, GITHUB' })).toHaveAttribute(
    'href',
    '/admin/providers',
  );
  await expect(results.getByText('Repositories', { exact: true })).toBeVisible();
  await expect(results.getByRole('option', { name: 'tobiaswaelde/ezrepo', exact: true })).toHaveAttribute(
    'href',
    '/repositories?repository=repository-1',
  );
  await expect(results.getByText('Workflow runs', { exact: true })).toBeVisible();
  await expect(results.getByRole('option', { name: 'ezRepo deployment, tobiaswaelde/ezrepo' })).toHaveAttribute(
    'href',
    'https://github.com/tobiaswaelde/ezrepo/actions/runs/42',
  );
  await expect(results).not.toContainText('obsolete');
  expect(requestedSearchUrls.filter((url) => url.includes('search=flow'))).toHaveLength(3);
  expect(requestedSearchUrls.every((url) => url.includes('perPage=20'))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('global-search-groups.png'), fullPage: true });

  await page.setViewportSize({ height: 844, width: 390 });
  await expect(results).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('global-search-mobile.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(results).not.toBeVisible();
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await search.click();
  await results.getByRole('option', { name: 'tobiaswaelde/ezrepo', exact: true }).click();
  await expect(page).toHaveURL(/\/repositories\?repository=repository-1$/);
  await expect(page.getByRole('dialog', { name: 'tobiaswaelde/ezrepo' })).toBeVisible();
});

test('does not request or expose provider accounts to a viewer and preserves successful groups on partial failure', async ({
  page,
}) => {
  await mockApplicationShell(page, 'VIEWER');
  let providerRequestCount = 0;
  await page.route(/\/api\/v1\/provider-accounts(?:\?.*)?$/, (route) => {
    providerRequestCount += 1;
    return route.fulfill({ status: 403 });
  });
  await page.route(/\/api\/v1\/repositories(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        ...emptyPage,
        items: [
          {
            enabled: true,
            id: 'repository-1',
            lastSyncAt: null,
            name: 'ezrepo',
            owner: 'tobiaswaelde',
            providerAccountId: 'provider-1',
            url: 'https://github.com/tobiaswaelde/ezrepo',
            workflowRunRetentionDays: null,
          },
        ],
      },
    }),
  );
  await page.route(/\/api\/v1\/workflow-runs(?:\?.*)?$/, (route) => route.fulfill({ status: 503 }));

  await page.goto('/');
  await page.getByRole('combobox', { name: 'Search' }).fill('flow');
  const results = page.getByRole('listbox', { name: 'Search results' });
  await expect(results.getByRole('option', { name: 'tobiaswaelde/ezrepo', exact: true })).toBeVisible();
  await expect(results.getByText('Some result groups could not be loaded.')).toBeVisible();
  await expect(results.getByText('Workflow runs', { exact: true })).toBeVisible();
  expect(providerRequestCount).toBe(0);
});
