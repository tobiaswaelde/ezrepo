import { expect, test, type Locator, type Page } from '@playwright/test';

/** Hover an action and verify its accessible tooltip content. */
async function expectActionTooltip(page: Page, trigger: Locator, text: string): Promise<void> {
  await ((await trigger.isDisabled()) ? trigger.locator('..') : trigger).hover();
  await expect(page.locator('[data-slot="content"][data-side]').filter({ hasText: text })).toBeVisible();
  await page.mouse.move(0, 0);
}

/** Verify that an icon has locally bundled SVG mask data. */
async function expectBundledIcon(icon: Locator): Promise<void> {
  await expect(icon).toBeVisible();
  await expect
    .poll(() => icon.evaluate((element) => getComputedStyle(element).getPropertyValue('--svg')))
    .toContain('data:image/svg+xml');
}

/** Verify that repository and user administration share the full Query Kit table layout. */
test('repository and user administration render full-page Query Kit tables', async ({ page }, testInfo) => {
  const externalIconRequests: string[] = [];
  await page.route(/https?:\/\/(?:api\.iconify\.design|cdn\.jsdelivr\.net|unpkg\.com)\/.*/, async (route) => {
    externalIconRequests.push(route.request().url());
    await route.abort();
  });
  let releaseRepositoryUpdate: (() => void) | undefined;
  const repositoryUpdateResponse = new Promise<void>((resolve) => {
    releaseRepositoryUpdate = resolve;
  });
  await page.addInitScript(() => window.localStorage.setItem('ezrepo.access-token', 'playwright-access-token'));
  await page.route(/\/api\/v1\/repositories(?:\?.*)?$/, async (route) => {
    expect(route.request().url()).toContain('fields=');
    expect(route.request().url()).toContain('workflowRunCount');
    await route.fulfill({
      contentType: 'application/json',
      json: {
        items: [
          {
            enabled: true,
            id: 'repository-1',
            lastSyncAt: null,
            members: Array.from({ length: 6 }, (_, index) => ({
              avatarUpdatedAt: null,
              userId: `member-${index + 1}`,
              username: `member-${index + 1}`,
            })),
            name: 'ezrepo',
            owner: 'twaelde',
            providerAccountId: 'provider-1',
            providerRepositoryId: 'repository-1',
            url: 'https://github.com/tobiaswaelde/ezrepo',
            workflowRunCount: 12,
            workflowRunRetentionDays: 30,
          },
        ],
        meta: { itemCount: 1, pageCount: 1 },
      },
    });
  });
  await page.route('**/api/v1/repositories/repository-1', async (route) => {
    expect(route.request().method()).toBe('PATCH');
    await repositoryUpdateResponse;
    await route.fulfill({ contentType: 'application/json', json: {} });
  });
  await page.route(/\/api\/v1\/users(?:\?.*)?$/, async (route) => {
    expect(route.request().url()).toContain('fields=');
    await route.fulfill({
      contentType: 'application/json',
      json: {
        items: [
          {
            createdAt: '2026-09-08T08:00:00.000Z',
            id: 'playwright-admin',
            role: 'SYSTEM_ADMIN',
            updatedAt: '2026-09-08T08:00:00.000Z',
            username: 'playwright',
          },
        ],
        meta: { itemCount: 1, pageCount: 1 },
      },
    });
  });
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: { id: 'playwright-admin', role: 'SYSTEM_ADMIN', username: 'playwright' },
    });
  });

  await page.goto('/repositories');

  await expectBundledIcon(page.locator('.i-lucide\\:git-branch').first());
  await expectBundledIcon(page.locator('.i-simple-icons\\:github').first());
  await expectBundledIcon(page.locator('.i-tabler\\:adjustments').first());

  const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' });
  const repositoryNavigation = primaryNavigation.getByRole('link', { name: 'Repositories' });
  await expect(repositoryNavigation).toHaveAttribute('href', '/repositories');
  await expect(repositoryNavigation).toHaveAttribute('aria-current', 'page');
  await expect(
    primaryNavigation.getByRole('region', { name: 'Administration' }).getByRole('link', { name: 'Repositories' }),
  ).toHaveCount(0);
  const repositoryBreadcrumb = page.getByRole('navigation', { name: 'breadcrumb' });
  await expect(repositoryBreadcrumb.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/');
  await expect(repositoryBreadcrumb).toContainText('Repositories');
  await expect(page.getByRole('columnheader', { name: 'Workflow runs' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Members' })).toBeVisible();
  await expect(page.locator('tbody')).toContainText('12');
  const membersCell = page.locator('tbody td').filter({ hasText: '+1' });
  await expect(membersCell).toContainText('+1');
  await membersCell.getByText('M1', { exact: true }).hover();
  const memberTooltip = page.locator('[data-slot="content"][data-side]').filter({ hasText: 'member-1' });
  await expect(memberTooltip).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(memberTooltip).toBeHidden();
  await expect(page.locator('tbody').getByRole('link', { name: 'ezrepo', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open in provider' })).toHaveAttribute(
    'href',
    'https://github.com/tobiaswaelde/ezrepo',
  );
  const repositoryActionsHeader = page.getByRole('columnheader', { name: 'Actions' });
  await expect(repositoryActionsHeader).toHaveCSS('position', 'sticky');
  await expect(repositoryActionsHeader.getByText('Actions', { exact: true })).toHaveClass(/justify-end/);
  await expect(page.locator('tbody td').first()).toHaveCSS('padding-top', '8px');
  const openRepositoryButton = page.getByRole('button', { name: 'Edit repository' });
  await expect(openRepositoryButton).toHaveClass(/text-sm/);
  await expectActionTooltip(page, openRepositoryButton, 'Edit repository');
  const toggleRepositoryButton = page.getByRole('button', { name: 'Disable' });
  await toggleRepositoryButton.click();
  await expect(toggleRepositoryButton).toBeDisabled();
  await expect(toggleRepositoryButton.locator('[data-slot="leadingIcon"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('repository-action-loading.png'), fullPage: true });
  releaseRepositoryUpdate?.();
  await expect(toggleRepositoryButton).toBeEnabled();
  await page.keyboard.press('Shift+O');
  await expect(page.getByText('Table options', { exact: true })).toBeVisible();
  await page.keyboard.press('Shift+O');

  await page.goto('/admin/users');

  const userBreadcrumb = page.getByRole('navigation', { name: 'breadcrumb' });
  await expect(userBreadcrumb.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/');
  await expect(userBreadcrumb).toContainText('Users');
  await expect(page.getByText('System administrator', { exact: true })).toBeVisible();
  const deleteUserButton = page.getByRole('button', { name: 'Delete' });
  await expect(deleteUserButton).toBeDisabled();
  await expectActionTooltip(page, deleteUserButton, 'Delete');
  await page.keyboard.press('Shift+O');
  await expect(page.getByText('Table options', { exact: true })).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath('user-table.png'), fullPage: true });
  expect(externalIconRequests).toEqual([]);
});

/** Verify that repository discovery supports searching and selecting multiple repositories. */
test('adds multiple repositories selected from an enabled provider account', async ({ page }, testInfo) => {
  const addedRepositoryIds: string[] = [];
  let releaseRepositoryDiscovery: (() => void) | undefined;
  let releaseRepositoryAdds: (() => void) | undefined;
  const repositoryDiscoveryResponse = new Promise<void>((resolve) => {
    releaseRepositoryDiscovery = resolve;
  });
  const repositoryAddResponses = new Promise<void>((resolve) => {
    releaseRepositoryAdds = resolve;
  });
  await page.addInitScript(() => window.localStorage.setItem('ezrepo.access-token', 'playwright-access-token'));
  await page.route(/\/api\/v1\/provider-accounts(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        items: [
          {
            displayName: 'Production GitHub',
            enabled: true,
            id: 'provider-1',
            providerType: 'GITHUB',
          },
          {
            displayName: 'Disabled GitLab',
            enabled: false,
            id: 'provider-2',
            providerType: 'GITLAB',
          },
        ],
        meta: { hasNextPage: false, hasPrevPage: false, itemCount: 2, page: 1, pageCount: 1, perPage: 100 },
      },
    });
  });
  await page.route('**/api/v1/provider-accounts/provider-1/repositories', async (route) => {
    await repositoryDiscoveryResponse;
    await route.fulfill({
      contentType: 'application/json',
      json: [
        {
          name: 'already-tracked',
          owner: 'ezrepo',
          providerRepositoryId: 'repository-1',
          tracked: true,
          url: 'https://github.com/ezrepo/already-tracked',
        },
        {
          name: 'new-repository',
          owner: 'ezrepo',
          providerRepositoryId: 'repository-2',
          tracked: false,
          url: 'https://github.com/ezrepo/new-repository',
        },
        {
          name: 'another-repository',
          owner: 'ezrepo',
          providerRepositoryId: 'repository-3',
          tracked: false,
          url: 'https://github.com/ezrepo/another-repository',
        },
      ],
    });
  });
  await page.route('**/api/v1/provider-accounts/provider-1/repositories', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON() as { providerRepositoryId: string };
    addedRepositoryIds.push(body.providerRepositoryId);
    await repositoryAddResponses;
    await route.fulfill({
      contentType: 'application/json',
      json: {
        enabled: true,
        id: body.providerRepositoryId,
        lastSyncAt: null,
        name: body.providerRepositoryId === 'repository-2' ? 'new-repository' : 'another-repository',
        owner: 'ezrepo',
        providerAccountId: 'provider-1',
        url: `https://github.com/ezrepo/${
          body.providerRepositoryId === 'repository-2' ? 'new-repository' : 'another-repository'
        }`,
        workflowRunRetentionDays: null,
      },
    });
  });
  await page.route(/\/api\/v1\/repositories(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        items: [],
        meta: { hasNextPage: false, hasPrevPage: false, itemCount: 0, page: 1, pageCount: 0, perPage: 10 },
      },
    });
  });
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: { id: 'playwright-admin', role: 'SYSTEM_ADMIN', username: 'playwright' },
    });
  });

  await page.goto('/repositories');
  await page.getByRole('button', { name: 'Add repository' }).click();
  await expect(page.getByRole('heading', { name: 'Add repositories' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Show popup' }).click();
  await page.getByRole('option', { name: 'Production GitHub (GitHub)' }).click();
  const nextButton = page.getByRole('button', { name: 'Next' });
  await expect(nextButton).toBeDisabled();
  await expect(nextButton.locator('[data-slot="leadingIcon"]')).toBeVisible();
  releaseRepositoryDiscovery?.();
  await expect(nextButton).toBeEnabled();
  await nextButton.click();
  await expect(page.getByRole('checkbox', { name: 'Select ezrepo/already-tracked' })).toBeDisabled();
  await page.getByPlaceholder('Search repositories').fill('repository');
  await page.getByRole('checkbox', { name: 'Select ezrepo/new-repository' }).click();
  await page.getByRole('checkbox', { name: 'Select ezrepo/another-repository' }).click();
  await expect(page.getByText('Selected: 2', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('multi-repository-selection.png'), fullPage: true });
  const addButton = page.getByRole('button', { name: 'Add selected (2)' });
  await addButton.click();
  await expect(addButton).toBeDisabled();
  await expect(addButton.locator('[data-slot="leadingIcon"]')).toBeVisible();
  await expect.poll(() => addedRepositoryIds.length).toBe(2);
  releaseRepositoryAdds?.();

  await expect(page.getByRole('heading', { name: 'Add repositories' })).not.toBeVisible();
  expect(addedRepositoryIds.sort()).toEqual(['repository-2', 'repository-3']);
});

/** Verify the repository dialog exposes retention, workflow filters, and memberships. */
test('repository dialog loads retention, filters, and members', async ({ page }) => {
  const repositoryUpdates: unknown[] = [];
  const createdFilters: unknown[] = [];
  const createdMemberships: unknown[] = [];
  await page.addInitScript(() => window.localStorage.setItem('ezrepo.access-token', 'playwright-access-token'));
  await page.route('**/api/v1/repositories/repository-1', async (route) => {
    if (route.request().method() === 'PATCH') {
      repositoryUpdates.push(route.request().postDataJSON());
      return route.fulfill({ contentType: 'application/json', json: {} });
    }
    await route.fulfill({
      contentType: 'application/json',
      json: {
        enabled: true,
        id: 'repository-1',
        lastSyncAt: null,
        name: 'ezrepo',
        owner: 'twaelde',
        providerAccountId: 'provider-1',
        url: 'https://github.com/tobiaswaelde/ezrepo',
        workflowRunRetentionDays: 30,
      },
    });
  });
  await page.route('**/api/v1/repositories/repository-1/workflow-filters', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      createdFilters.push(body);
      return route.fulfill({
        contentType: 'application/json',
        json: { id: 'filter-2', repositoryId: 'repository-1', ...(body as object) },
      });
    }
    await route.fulfill({
      contentType: 'application/json',
      json: [{ id: 'filter-1', mode: 'DENY', pattern: 'draft-*', repositoryId: 'repository-1' }],
    });
  });
  await page.route('**/api/v1/repositories/repository-1/memberships/user-2', async (route) => {
    const body = route.request().postDataJSON();
    createdMemberships.push(body);
    await route.fulfill({
      contentType: 'application/json',
      json: {
        id: 'membership-2',
        repositoryId: 'repository-1',
        role: (body as { role: string }).role,
        user: { id: 'user-2', role: 'VIEWER', username: 'viewer' },
        userId: 'user-2',
      },
    });
  });
  await page.route('**/api/v1/repositories/repository-1/memberships', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: [
        {
          id: 'membership-1',
          repositoryId: 'repository-1',
          role: 'MANAGER',
          user: { id: 'user-1', role: 'MANAGER', username: 'maintainer' },
          userId: 'user-1',
        },
      ],
    });
  });
  await page.route(/\/api\/v1\/users(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        items: [
          {
            createdAt: '2026-09-08T08:00:00.000Z',
            id: 'user-2',
            role: 'VIEWER',
            updatedAt: '2026-09-08T08:00:00.000Z',
            username: 'viewer',
          },
        ],
        meta: { hasNextPage: false, hasPrevPage: false, itemCount: 1, page: 1, pageCount: 1, perPage: 100 },
      },
    });
  });
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: { id: 'playwright-admin', role: 'SYSTEM_ADMIN', username: 'playwright' },
    });
  });
  await page.route(/\/api\/v1\/repositories(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: { items: [], meta: { itemCount: 0, pageCount: 0 } },
    });
  });

  await page.goto('/repositories?repository=repository-1');

  const repositoryDialog = page.getByRole('dialog', { name: 'twaelde/ezrepo' });
  await expect(repositoryDialog).toBeVisible();
  await expect(repositoryDialog.locator('input[type=number]')).toHaveValue('30');
  await expect(repositoryDialog.getByText('draft-*', { exact: true })).toBeVisible();
  await expect(repositoryDialog.getByText('maintainer', { exact: true })).toBeVisible();
  await expect(repositoryDialog.getByRole('button', { name: 'Add workflow filter' })).toBeDisabled();
  await expect(repositoryDialog.getByRole('button', { name: 'Add member' })).toBeDisabled();
  await expect(repositoryDialog.getByRole('columnheader', { name: 'Actions' }).first()).toHaveCSS('position', 'sticky');
  await expect(repositoryDialog.getByRole('button', { name: 'Delete' })).toHaveClass(/text-sm/);
  await expectActionTooltip(page, repositoryDialog.getByRole('button', { name: 'Delete' }), 'Delete');
  await expectActionTooltip(page, repositoryDialog.getByRole('button', { name: 'Remove member' }), 'Remove member');

  await repositoryDialog.locator('input[type=number]').fill('45');
  await repositoryDialog.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => repositoryUpdates).toEqual([{ enabled: true, workflowRunRetentionDays: 45 }]);

  await repositoryDialog.getByPlaceholder('e.g. build-*').fill('release-*');
  await repositoryDialog.getByRole('button', { name: 'Add workflow filter' }).click();
  await expect(repositoryDialog.getByText('release-*', { exact: true })).toBeVisible();
  expect(createdFilters).toEqual([{ mode: 'ALLOW', pattern: 'release-*' }]);

  await repositoryDialog.getByRole('button', { name: 'Show popup' }).click();
  await page.getByRole('option', { name: 'viewer' }).click();
  await repositoryDialog.getByRole('button', { name: 'Add member' }).click();
  await expect(repositoryDialog.getByText('viewer', { exact: true })).toBeVisible();
  expect(createdMemberships).toEqual([{ role: 'VIEWER' }]);
});

/** Verify that workflow-run history is available as a child of the workflow-runs navigation group. */
test('workflow runs render in a filterable and sortable full-page table', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('ezrepo.access-token', 'playwright-access-token');
    window.localStorage.setItem(
      'table:workflow-runs:filtering',
      JSON.stringify({
        filters: [
          {
            field: 'repositoryId',
            id: 'repository-filter',
            operator: 'in',
            type: 'enum',
            value: ['repository-1'],
          },
          {
            field: 'repository.providerAccount.providerType',
            id: 'provider-filter',
            operator: 'in',
            type: 'enum',
            value: ['GITHUB'],
          },
          { field: 'durationMs', id: 'duration-filter', operator: 'gte', type: 'number', value: 90_000 },
          { field: 'status', id: 'status-filter', operator: 'in', type: 'enum', value: ['SUCCESS'] },
        ],
        operator: 'AND',
      }),
    );
  });
  const workflowRunRequestUrls: string[] = [];
  let repositoryFilterRequestFails = false;
  await page.route(/\/api\/v1\/workflow-runs(?:\?.*)?$/, async (route) => {
    const requestUrl = route.request().url();
    workflowRunRequestUrls.push(requestUrl);
    expect(requestUrl).toContain('fields=');
    expect(requestUrl).toContain('repositoryName');
    expect(requestUrl).toContain('repositoryOwner');
    expect(requestUrl).toContain('providerType');
    expect(requestUrl).toContain('workflowName');
    await route.fulfill({
      contentType: 'application/json',
      json: {
        items: [
          {
            completedAt: '2026-09-08T08:02:30.000Z',
            displayTitle: 'Build on main',
            durationMs: 150_000,
            id: 'run-1',
            providerCreatedAt: '2026-09-08T08:00:00.000Z',
            providerRunId: '42',
            providerType: 'GITHUB',
            repositoryId: 'repository-1',
            repositoryName: 'ezrepo',
            repositoryOwner: 'twaelde',
            startedAt: '2026-09-08T08:00:00.000Z',
            status: 'SUCCESS',
            url: 'https://github.com/tobiaswaelde/ezrepo/actions/runs/42',
            workflowName: 'Build',
          },
        ],
        meta: { hasNextPage: false, hasPrevPage: false, itemCount: 1, page: 1, pageCount: 1, perPage: 25 },
      },
    });
  });
  await page.route(/\/api\/v1\/repositories(?:\?.*)?$/, async (route) => {
    if (repositoryFilterRequestFails) return route.abort('failed');
    const requestUrl = new URL(route.request().url());
    expect(requestUrl.searchParams.get('fields')).toBe('id,name,owner');
    expect(requestUrl.searchParams.get('perPage')).toBe('1000');
    await route.fulfill({
      contentType: 'application/json',
      json: {
        items: [{ id: 'repository-1', name: 'ezrepo', owner: 'twaelde' }],
        meta: { hasNextPage: false, hasPrevPage: false, itemCount: 1, page: 1, pageCount: 1, perPage: 1_000 },
      },
    });
  });
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: { id: 'playwright-admin', role: 'SYSTEM_ADMIN', username: 'playwright' },
    });
  });

  await page.goto('/workflow-runs');

  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(navigation.getByRole('button', { name: 'Workflow runs' })).toHaveAttribute('aria-expanded', 'true');
  await expect(
    navigation.getByRole('region', { name: 'Workflow runs' }).getByRole('link', { name: 'All runs' }),
  ).toHaveAttribute('href', '/workflow-runs');
  await expect(
    navigation.getByRole('region', { name: 'Workflow runs' }).getByRole('link', { name: 'All runs' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('columnheader', { name: 'Title' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Workflow' })).toBeVisible();
  await expect(page.locator('tbody').getByText('Build on main', { exact: true })).toBeVisible();
  await expect(page.locator('tbody').getByText('Build', { exact: true })).toBeVisible();
  await expect(page.locator('tbody').getByRole('link', { name: 'Build on main', exact: true })).toHaveCount(0);
  await expect(page.getByText('twaelde/ezrepo', { exact: true })).toBeVisible();
  await expect(page.locator('#main-content').getByText('GitHub', { exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Provider time' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Started' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Provider run ID' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Completed' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Actions' })).toHaveCSS('position', 'sticky');
  await expect(page.locator('tbody')).not.toContainText(/\b(?:AM|PM)\b/);
  const externalLink = page.getByRole('link', { name: 'Open in provider' });
  await expect(externalLink).toHaveAttribute('href', 'https://github.com/tobiaswaelde/ezrepo/actions/runs/42');
  await expect(externalLink.locator('[aria-hidden="true"]')).toBeVisible();
  await expectActionTooltip(page, externalLink, 'Open in provider');
  await expect(page.getByText('Success', { exact: true })).toBeVisible();
  const where = JSON.parse(new URL(workflowRunRequestUrls.at(-1)!).searchParams.get('where')!) as Record<
    string,
    unknown
  >;
  expect(where).toEqual({
    AND: [
      { repositoryId: { in: ['repository-1'] } },
      { repository: { providerAccount: { providerType: { in: ['GITHUB'] } } } },
      { durationMs: { gte: 90_000 } },
      { status: { in: ['SUCCESS'] } },
    ],
  });
  await page.keyboard.press('Shift+F');
  const filteringPopover = page.locator('.qk-table-filtering-popover');
  await expect(filteringPopover.getByText('Repository', { exact: true })).toBeVisible();
  await expect(filteringPopover.getByText('Provider', { exact: true })).toBeVisible();
  await expect(filteringPopover.getByText('Duration (seconds)', { exact: true })).toBeVisible();
  await expect(filteringPopover.getByText('Status', { exact: true })).toBeVisible();
  await expect(filteringPopover.getByRole('spinbutton')).toHaveValue('90');
  await expect.poll(() => filteringPopover.evaluate((element) => window.getComputedStyle(element).opacity)).toBe('1');
  await page.screenshot({ path: testInfo.outputPath('workflow-run-filters.png'), fullPage: true });
  await filteringPopover.getByRole('spinbutton').fill('120');
  await filteringPopover.getByRole('spinbutton').press('Tab');
  await expect
    .poll(() => new URL(workflowRunRequestUrls.at(-1)!).searchParams.get('where'))
    .toContain('"durationMs":{"gte":120000}');
  await page.keyboard.press('Shift+F');
  await page.keyboard.press('Shift+O');
  await expect(page.getByText('Table options', { exact: true })).toBeVisible();
  await expect(page.locator('.qk-table-options-popover').getByText('Workflow', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Sort' }).click();
  await page.locator('.qk-table-sorting-popover').getByText('Select field', { exact: true }).click();
  await expect(page.getByRole('option', { name: 'Workflow', exact: true })).toBeVisible();

  repositoryFilterRequestFails = true;
  await page.reload();
  await expect(page.getByText('Repository filter options could not be loaded.', { exact: true })).toBeVisible();
  await expect(page.getByText('twaelde/ezrepo', { exact: true })).toBeVisible();
});
