import { expect, test, type Page } from '@playwright/test';

const emptyPage = {
  items: [],
  meta: { hasNextPage: false, hasPrevPage: false, itemCount: 0, page: 1, pageCount: 0, perPage: 5 },
};

const repository = {
  enabled: true,
  id: 'repository-1',
  lastSyncAt: '2020-01-01T00:00:00.000Z',
  members: [],
  name: 'ezrepo',
  owner: 'twaelde',
  providerAccountId: 'provider-1',
  providerRepositoryId: '42',
  syncIntervalSeconds: 1_800,
  syncState: {
    attempt: 2,
    lastError: 'Provider rate limit exceeded.',
    progressCurrent: 2,
    progressPhase: 'SYNCING_ISSUES',
    progressTotal: 3,
    requestedAt: '2026-09-29T08:00:00.000Z',
    scopes: ['WORKFLOWS', 'ISSUES', 'PULL_REQUESTS'],
    startedAt: '2026-09-29T08:01:00.000Z',
    status: 'RUNNING',
  },
  url: 'https://github.com/tobiaswaelde/ezrepo',
  workflowRunCount: 12,
  workflowRunRetentionDays: 30,
};

/** Mock the authenticated viewer shell and sidebar counters. */
async function mockViewerShell(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('ezrepo.access-token', 'playwright-access-token'));
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ json: { id: 'viewer-1', role: 'VIEWER', username: 'viewer' } }),
  );
  await page.route(/\/api\/v1\/settings$/, (route) =>
    route.fulfill({ json: { dateTimeFormat: 'LOCALE_MEDIUM', workflowRunRetentionDays: 90 } }),
  );
  await page.route('**/api/v1/dashboard/awaiting-approval', (route) => route.fulfill({ json: [] }));
  await page.route(/\/api\/v1\/workflow-runs\/needs-attention(?:\?.*)?$/, (route) =>
    route.fulfill({ json: emptyPage }),
  );
}

test('shows repository freshness, activity, provider links, and a partial section error', async ({
  page,
}, testInfo) => {
  await mockViewerShell(page);
  let releaseRepository: (() => void) | undefined;
  const repositoryResponse = new Promise<void>((resolve) => {
    releaseRepository = resolve;
  });
  await page.route('**/api/v1/repositories/repository-1', async (route) => {
    await repositoryResponse;
    await route.fulfill({ json: repository });
  });
  await page.route(/\/api\/v1\/workflow-runs\?.*$/, (route) =>
    route.fulfill({
      json: {
        ...emptyPage,
        items: [
          {
            completedAt: '2026-09-29T08:05:00.000Z',
            displayTitle: 'Build main',
            id: 'run-1',
            providerCreatedAt: '2026-09-29T08:00:00.000Z',
            status: 'SUCCESS',
            url: 'https://github.com/tobiaswaelde/ezrepo/actions/runs/1',
            workflowName: 'Build',
          },
        ],
      },
    }),
  );
  await page.route(/\/api\/v1\/issues\?.*$/, (route) => route.fulfill({ status: 500 }));
  await page.route(/\/api\/v1\/pull-requests\?.*$/, (route) =>
    route.fulfill({
      json: {
        ...emptyPage,
        items: [
          {
            id: 'pull-request-1',
            number: '17',
            providerUpdatedAt: '2026-09-29T08:04:00.000Z',
            state: 'OPEN',
            title: 'Improve repository details',
            url: 'https://github.com/tobiaswaelde/ezrepo/pull/17',
          },
        ],
      },
    }),
  );

  await page.goto('/repositories/repository-1');
  await expect(page.locator('.animate-pulse').first()).toBeVisible();
  releaseRepository?.();

  await expect(page).toHaveTitle('twaelde/ezrepo · ezRepo');
  await expect(page.getByText('Repository data is stale')).toBeVisible();
  await expect(page.getByText('Provider rate limit exceeded.')).toBeVisible();
  await expect(page.getByText('Active synchronization: Workflows, Issues, Pull requests')).toBeVisible();
  await expect(page.getByText('Build main')).toBeVisible();
  await expect(page.getByText('Improve repository details')).toBeVisible();
  await expect(page.getByText('Issues could not be loaded.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open in provider' }).first()).toHaveAttribute('href', repository.url);
  await expect(page.getByRole('heading', { name: 'Repository settings' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('repository-detail-desktop.png'), fullPage: true });
});

test('shows never-synchronized and empty states', async ({ page }) => {
  await mockViewerShell(page);
  await page.route('**/api/v1/repositories/repository-1', (route) =>
    route.fulfill({
      json: {
        ...repository,
        lastSyncAt: null,
        syncState: { ...repository.syncState, lastError: null, status: 'IDLE' },
      },
    }),
  );
  await page.route(/\/api\/v1\/(?:workflow-runs|issues|pull-requests)\?.*$/, (route) =>
    route.fulfill({ json: emptyPage }),
  );

  await page.goto('/repositories/repository-1');

  await expect(page.getByText('This repository has never been synchronized.')).toBeVisible();
  await expect(page.getByText(/No .* found for this repository\./)).toHaveCount(3);
});

test('shows the permission error without loading repository activity', async ({ page }) => {
  await mockViewerShell(page);
  let activityRequests = 0;
  await page.route('**/api/v1/repositories/repository-1', (route) => route.fulfill({ status: 404 }));
  await page.route(/\/api\/v1\/(?:workflow-runs|issues|pull-requests)\?.*$/, (route) => {
    activityRequests += 1;
    return route.fulfill({ json: emptyPage });
  });

  await page.goto('/repositories/repository-1');

  await expect(page.getByText('This repository was not found or is not available to you.')).toBeVisible();
  expect(activityRequests).toBe(0);
});
