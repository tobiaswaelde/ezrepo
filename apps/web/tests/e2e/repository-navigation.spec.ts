import { expect, test, type Page } from '@playwright/test';

const repository = {
  enabled: true,
  id: 'repository-1',
  lastSyncAt: null,
  name: 'ezrepo',
  owner: 'twaelde',
  providerAccountId: 'provider-1',
  providerRepositoryId: 'repository-1',
  url: 'https://github.com/tobiaswaelde/ezrepo',
  workflowRunCount: 12,
  workflowRunRetentionDays: 30,
};

/** Configure the assigned repository list and detail for a non-administrative user. */
async function mockViewerRepositories(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('ezrepo.access-token', 'playwright-access-token'));
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ json: { id: 'playwright-viewer', role: 'VIEWER', username: 'playwright' } }),
  );
  await page.route(/\/api\/v1\/repositories(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: [repository],
        meta: { hasNextPage: false, hasPrevPage: false, itemCount: 1, page: 1, pageCount: 1, perPage: 10 },
      },
    }),
  );
  await page.route('**/api/v1/repositories/repository-1', (route) => route.fulfill({ json: repository }));
  await page.route('**/api/v1/dashboard/awaiting-approval', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/workflow-runs/needs-attention**', (route) =>
    route.fulfill({
      json: {
        items: [],
        meta: { hasNextPage: false, hasPrevPage: false, itemCount: 0, page: 1, pageCount: 0, perPage: 1 },
      },
    }),
  );
}

test('viewer cannot access repository webhook controls', async ({ page }) => {
  await mockViewerRepositories(page);
  await page.goto('/repositories?repository=repository-1');

  await expect(page.getByRole('columnheader', { name: 'Webhook' })).toHaveCount(0);
  const dialog = page.getByRole('dialog', { name: 'twaelde/ezrepo' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Repository webhook' })).toHaveCount(0);
});

test('viewer browses assigned repositories without administration actions', async ({ page }, testInfo) => {
  await mockViewerRepositories(page);
  await page.goto('/repositories');

  await expect(page).toHaveTitle('Repositories · ezRepo');
  const brandLink = page.getByRole('link', { name: 'ezRepo' });
  await expect(brandLink).toHaveText('ezRepo');
  await expect(brandLink).toHaveAttribute('href', '/');
  await expect(page.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/tobiaswaelde/ezrepo',
  );
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  const repositoriesLink = navigation.getByRole('link', { name: 'Repositories' });
  await expect(repositoriesLink).toHaveAttribute('href', '/repositories');
  await expect(repositoriesLink).toHaveAttribute('aria-current', 'page');
  await expect(navigation.getByText('Administration', { exact: true })).toHaveCount(0);
  await expect(page.getByText('twaelde', { exact: true })).toBeVisible();
  await expect(page.getByText('ezrepo', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add repository' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Disable' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Webhook' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open in provider' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('viewer-repository-navigation-desktop.png'), fullPage: true });

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  await expect(brandLink.locator('img')).toBeVisible();
  await expect(brandLink).toHaveText('');
  await expect(navigation.getByRole('button', { name: 'Workflow runs' })).toBeVisible();
  await expect(repositoriesLink).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: testInfo.outputPath('viewer-repository-navigation-collapsed.png'), fullPage: true });
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(brandLink).toHaveText('ezRepo');

  await page.getByPlaceholder('Search ezRepo').fill('repositories');
  await expect(page.getByRole('link', { name: 'Repositories' }).last()).toHaveAttribute('href', '/repositories');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open repository' }).click();

  await expect(page).toHaveURL(/\/repositories\?repository=repository-1$/);
  const repositoryDialog = page.getByRole('dialog', { name: 'twaelde/ezrepo' });
  await expect(repositoryDialog).toBeVisible();
  await expect(repositoryDialog.getByText('Enabled', { exact: true })).toBeVisible();
  await expect(repositoryDialog.getByRole('button', { name: 'Save' })).toHaveCount(0);
  await expect(repositoryDialog.getByRole('button', { name: 'Refresh provider data' })).toHaveCount(0);
  await expect(repositoryDialog.getByRole('heading', { name: 'Workflow filters' })).toHaveCount(0);
  await expect(repositoryDialog.getByRole('heading', { name: 'Members' })).toHaveCount(0);
  await expect(repositoryDialog.getByRole('heading', { name: 'Repository webhook' })).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/repositories$/);
  await expect(repositoryDialog).not.toBeVisible();
  await expect(repositoriesLink).toHaveAttribute('aria-current', 'page');
  await page.goForward();
  await expect(repositoryDialog).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/repositories\?repository=repository-1$/);
  await expect(repositoryDialog).toBeVisible();

  await page.goto('/repositories/repository-1?source=detail#settings');
  await expect
    .poll(() => {
      const url = new URL(page.url());
      return `${url.pathname}|${url.searchParams.get('repository')}|${url.searchParams.get('source')}|${url.hash}`;
    })
    .toBe('/repositories|repository-1|detail|#settings');
  await expect(repositoryDialog).toBeVisible();

  await page.goto('/admin/repositories/repository-1?source=legacy#details');
  await expect
    .poll(() => {
      const url = new URL(page.url());
      return `${url.pathname}|${url.searchParams.get('repository')}|${url.searchParams.get('source')}|${url.hash}`;
    })
    .toBe('/repositories|repository-1|legacy|#details');
  await page.setViewportSize({ height: 844, width: 390 });
  await expect(repositoryDialog).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('viewer-repository-mobile.png'), fullPage: true });
});

test('administrator refreshes renamed repository metadata from the provider', async ({ page }, testInfo) => {
  let releaseRefresh: (() => void) | undefined;
  let refreshAttempts = 0;
  const refreshResponse = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  await page.addInitScript(() => window.localStorage.setItem('ezrepo.access-token', 'playwright-access-token'));
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ json: { id: 'playwright-admin', role: 'SYSTEM_ADMIN', username: 'playwright' } }),
  );
  await page.route('**/api/v1/repositories/repository-1/refresh', async (route) => {
    refreshAttempts += 1;
    if (refreshAttempts > 1) {
      await route.fulfill({ json: { message: 'Provider repository not found.' }, status: 404 });
      return;
    }
    await refreshResponse;
    await route.fulfill({
      json: {
        ...repository,
        name: 'ezrepo',
        owner: 'new-owner',
        url: 'https://github.com/new-owner/ezrepo',
      },
    });
  });
  await page.route('**/api/v1/repositories/repository-1/workflow-filters', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/repositories/repository-1/memberships', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/repositories/webhook-configurations', (route) =>
    route.fulfill({
      json: [
        {
          callbackUrl: 'https://ezrepo.example.test/api/webhooks/github/repository-1',
          configured: false,
          lastDeliveryAt: null,
          providerType: 'GITHUB',
          repositoryId: 'repository-1',
        },
      ],
    }),
  );
  await page.route(/\/api\/v1\/users(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { items: [], meta: { itemCount: 0, pageCount: 0 } } }),
  );
  await page.route('**/api/v1/repositories/repository-1', (route) => route.fulfill({ json: repository }));
  await page.route(/\/api\/v1\/repositories(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: [repository],
        meta: { hasNextPage: false, hasPrevPage: false, itemCount: 1, page: 1, pageCount: 1, perPage: 10 },
      },
    }),
  );

  await page.goto('/repositories?repository=repository-1');

  const refreshButton = page.getByRole('button', { name: 'Refresh provider data' });
  await refreshButton.click();
  await expect(refreshButton).toBeDisabled();
  await expect(refreshButton.locator('[data-slot="leadingIcon"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('repository-refresh-loading.png'), fullPage: true });
  releaseRefresh?.();

  await expect(page.getByRole('dialog', { name: 'new-owner/ezrepo' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open in provider' })).toHaveAttribute(
    'href',
    'https://github.com/new-owner/ezrepo',
  );
  await expect(page.getByText('Repository data was refreshed from the provider.', { exact: true })).toBeVisible();

  await refreshButton.click();
  await expect(
    page.getByText('Repository data could not be refreshed from the provider.', { exact: true }),
  ).toBeVisible();
});

test('administrator configures a webhook for one repository', async ({ page }, testInfo) => {
  let configured = false;
  let requestFails = false;
  let savedSecret = '';
  let releaseSave: (() => void) | undefined;
  const saveResponse = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  const configuration = () => ({
    callbackUrl: 'https://ezrepo.example.test/api/webhooks/github/repository-1',
    configured,
    lastDeliveryAt: configured ? '2026-09-13T12:00:00.000Z' : null,
    providerType: 'GITHUB',
    repositoryId: 'repository-1',
  });

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => window.localStorage.setItem('ezrepo.access-token', 'playwright-access-token'));
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ json: { id: 'playwright-admin', role: 'SYSTEM_ADMIN', username: 'playwright' } }),
  );
  await page.route('**/api/v1/repositories/webhook-configurations', (route) =>
    route.fulfill({ json: [configuration()] }),
  );
  await page.route('**/api/v1/repositories/repository-1/webhook-configuration', async (route) => {
    if (route.request().method() === 'DELETE') {
      configured = false;
      await route.fulfill({ status: 204 });
      return;
    }
    savedSecret = (route.request().postDataJSON() as { webhookSecret: string }).webhookSecret;
    if (!configured) await saveResponse;
    if (requestFails) {
      await route.fulfill({ json: { message: 'failed' }, status: 500 });
      return;
    }
    configured = true;
    await route.fulfill({ json: configuration() });
  });
  await page.route('**/api/v1/repositories/repository-1/workflow-filters', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/repositories/repository-1/memberships', (route) => route.fulfill({ json: [] }));
  await page.route(/\/api\/v1\/users(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { items: [], meta: { itemCount: 0, pageCount: 0 } } }),
  );
  await page.route('**/api/v1/repositories/repository-1', (route) => route.fulfill({ json: repository }));
  await page.route(/\/api\/v1\/repositories(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: [repository],
        meta: { hasNextPage: false, hasPrevPage: false, itemCount: 1, page: 1, pageCount: 1, perPage: 10 },
      },
    }),
  );

  await page.goto('/repositories');
  await expect(page.getByRole('columnheader', { name: 'Webhook' })).toBeVisible();
  await expect(page.getByText('Not configured', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit repository' }).click();

  const dialog = page.getByRole('dialog', { name: 'twaelde/ezrepo' });
  await expect(dialog.getByRole('heading', { name: 'Repository webhook' })).toBeVisible();
  await expect(
    dialog.locator('input[value="https://ezrepo.example.test/api/webhooks/github/repository-1"]'),
  ).toBeVisible();
  await expect(dialog.getByText(/Workflow runs \(workflow_run\)/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('repository-webhook-dark.png'), fullPage: true });

  await dialog.getByRole('button', { name: 'Generate secret' }).click();
  const secretInput = dialog.getByRole('textbox', { name: 'Signing secret' });
  await expect(secretInput).toHaveValue(/^[A-Za-z0-9+/]{43}=$/);
  await dialog.getByRole('button', { name: 'Save secret' }).click();
  await expect(dialog.getByRole('button', { name: 'Save secret' })).toBeDisabled();
  expect(savedSecret).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  releaseSave?.();

  await expect(dialog.getByText('Webhook secret saved')).toBeVisible();
  await expect(dialog.getByText('Configured', { exact: true })).toBeVisible();
  await expect(secretInput).toHaveValue(savedSecret);
  await expect(dialog.getByText('This repository webhook requires an update')).toBeVisible();

  await secretInput.fill('replacement-token');
  await dialog.getByText("I will update this repository's provider webhook with the new secret.").click();
  requestFails = true;
  await dialog.getByRole('button', { name: 'Rotate secret' }).click();
  await expect(dialog.getByText('The webhook secret could not be updated.')).toBeVisible();
  requestFails = false;

  page.once('dialog', (confirmation) => confirmation.accept());
  await dialog.getByRole('button', { name: 'Remove configuration' }).click();
  await expect(dialog.getByText('Not configured', { exact: true })).toBeVisible();
  await expect(page.getByText('Not configured', { exact: true }).first()).toBeVisible();

  await page.evaluate(() => window.localStorage.setItem('nuxt-color-mode', 'light'));
  await page.setViewportSize({ height: 844, width: 390 });
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/light/);
  await expect(dialog.getByRole('heading', { name: 'Repository webhook' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('repository-webhook-light-mobile.png'), fullPage: true });
});
