import { expect, test, type Page } from '@playwright/test';

const alert = {
  description: 'Upgrade the affected dependency.',
  ecosystem: 'npm',
  fixedVersion: '7.1.2',
  id: 'alert-1',
  identifiers: ['CVE-2026-0001'],
  kind: 'DEPENDENCY',
  location: null,
  manifest: 'pnpm-lock.yaml',
  packageName: 'vite',
  providerCreatedAt: '2026-09-28T08:00:00.000Z',
  providerType: 'GITHUB',
  providerUpdatedAt: '2026-09-29T08:00:00.000Z',
  providerUrl: 'https://github.test/ezrepo/security/dependabot/1',
  repositoryId: 'repository-1',
  repositoryName: 'ezrepo',
  repositoryOwner: 'tobiaswaelde',
  resolution: null,
  resolvedAt: null,
  ruleId: null,
  scanner: 'Dependabot',
  secretProvider: null,
  secretType: null,
  severity: 'HIGH',
  state: 'OPEN',
  title: 'Vite path traversal',
  tool: null,
  vulnerableRange: '<7.1.2',
};

async function mockShell(page: Page, role: 'MANAGER' | 'VIEWER'): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('ezrepo.access-token', 'playwright-access-token'));
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ json: { id: role.toLocaleLowerCase(), role, username: role.toLocaleLowerCase() } }),
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
}

test('renders permission-scoped alerts, availability warnings, details, and a responsive layout', async ({
  page,
}, testInfo) => {
  await mockShell(page, 'MANAGER');
  const listUrls: string[] = [];
  await page.route('**/api/v1/security-alerts/summary', (route) =>
    route.fulfill({
      json: {
        open: { CODE: 0, DEPENDENCY: 1, SECRET: 0 },
        severity: { CRITICAL: 0, HIGH: 1, INFO: 0, LOW: 0, MEDIUM: 0, UNKNOWN: 0 },
        unavailableRepositories: 1,
      },
    }),
  );
  await page.route('**/api/v1/security-alerts/filter-options', (route) =>
    route.fulfill({
      json: {
        availability: [
          {
            availability: 'UNAVAILABLE',
            kind: 'DEPENDENCY',
            lastSuccessfulSyncAt: null,
            reason: 'Missing permission.',
            repositoryId: 'repository-1',
          },
        ],
        ecosystems: ['npm'],
        manifests: ['pnpm-lock.yaml'],
        packages: ['vite'],
        paths: [],
        repositories: [{ id: 'repository-1', name: 'ezrepo', owner: 'tobiaswaelde' }],
        rules: [],
        scanners: ['Dependabot'],
        secretProviders: [],
        secretTypes: [],
      },
    }),
  );
  await page.route(/\/api\/v1\/security-alerts(?:\?.*)?$/, (route) => {
    listUrls.push(route.request().url());
    return route.fulfill({
      json: {
        items: [{ ...alert, description: undefined }],
        meta: { hasNextPage: false, hasPrevPage: false, itemCount: 1, page: 1, pageCount: 1, perPage: 25 },
      },
    });
  });
  await page.route('**/api/v1/security-alerts/alert-1', (route) => route.fulfill({ json: alert }));

  await page.goto('/alerts/dependencies');

  await expect(page.getByRole('heading', { name: 'Dependency alerts' })).toBeVisible();
  await expect(
    page.getByText(
      '1 repositories do not currently expose this alert type. Other synchronized data remains available.',
    ),
  ).toBeVisible();
  await expect(page.getByText('Vite path traversal')).toBeVisible();
  await expect(page.getByText('tobiaswaelde/ezrepo')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search alerts' }).fill('vite');
  await page.getByLabel('Updated from').fill('2026-09-01');
  await expect
    .poll(() => decodeURIComponent(new URL(listUrls.at(-1)!).searchParams.get('where') ?? ''))
    .toContain('2026-09-01');
  await expect
    .poll(() => decodeURIComponent(new URL(listUrls.at(-1)!).searchParams.get('where') ?? ''))
    .toContain('vite');
  await page.getByRole('link', { name: 'Vite path traversal' }).click();
  await expect(page.getByText('Upgrade the affected dependency.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open in provider' })).toHaveAttribute('href', alert.providerUrl);
  await page.screenshot({ path: testInfo.outputPath('security-alert-detail.png'), fullPage: true });

  await page.setViewportSize({ height: 844, width: 390 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('security-alert-detail-mobile.png'), fullPage: true });
});

test('hides alert navigation and routes from viewers', async ({ page }) => {
  await mockShell(page, 'VIEWER');
  await page.route('**/api/v1/dashboard/summary**', (route) =>
    route.fulfill({
      json: {
        activeCount: 0,
        awaitingApprovalCount: 0,
        completedCount: 0,
        medianDurationMs: 0,
        queuedCount: 0,
        runningCount: 0,
        statuses: {},
        successRate: 0,
        totalRunDurationMs: 0,
      },
    }),
  );
  await page.route('**/api/v1/dashboard/failures', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/dashboard/latest-runs', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/dashboard/trend**', (route) => route.fulfill({ json: [] }));

  await page.goto('/');
  await expect(page.getByText('Alerts', { exact: true })).toHaveCount(0);
  await page.goto('/alerts/dependencies');
  await expect(page).toHaveURL(/\/$/);
});

test('shows empty and request-error states', async ({ page }) => {
  await mockShell(page, 'MANAGER');
  let failList = false;
  await page.route('**/api/v1/security-alerts/summary', (route) =>
    route.fulfill({
      json: {
        open: { CODE: 0, DEPENDENCY: 0, SECRET: 0 },
        severity: { CRITICAL: 0, HIGH: 0, INFO: 0, LOW: 0, MEDIUM: 0, UNKNOWN: 0 },
        unavailableRepositories: 0,
      },
    }),
  );
  await page.route('**/api/v1/security-alerts/filter-options', (route) =>
    route.fulfill({
      json: {
        availability: [],
        ecosystems: [],
        manifests: [],
        packages: [],
        paths: [],
        repositories: [],
        rules: [],
        scanners: [],
        secretProviders: [],
        secretTypes: [],
      },
    }),
  );
  await page.route(/\/api\/v1\/security-alerts(?:\?.*)?$/, (route) =>
    failList
      ? route.fulfill({ status: 500 })
      : route.fulfill({
          json: {
            items: [],
            meta: { hasNextPage: false, hasPrevPage: false, itemCount: 0, page: 1, pageCount: 0, perPage: 25 },
          },
        }),
  );

  await page.goto('/alerts/dependencies');
  await expect(page.getByText('No security alerts match the current filters.')).toBeVisible();

  failList = true;
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText('Security alerts could not be loaded.')).toBeVisible();
});
