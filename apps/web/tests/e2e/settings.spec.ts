import { expect, test } from '@playwright/test';

const nonSquarePng = Buffer.from(
  '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',
  'base64',
);

/** Configure global defaults and apply the selected timestamp format across administration pages. */
test('updates global retention and date-time formatting with visible request progress', async ({ page }, testInfo) => {
  let settings = {
    dateTimeFormat: 'LOCALE_MEDIUM',
    issueRetentionDays: 90,
    pullRequestRetentionDays: 90,
    workflowRunRetentionDays: 90,
  };
  let releaseSettingsUpdate: (() => void) | undefined;
  const settingsUpdateResponse = new Promise<void>((resolve) => {
    releaseSettingsUpdate = resolve;
  });

  await page.addInitScript(() => window.localStorage.setItem('ezrepo.access-token', 'playwright-access-token'));
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        firstName: null,
        id: 'playwright-admin',
        lastName: null,
        role: 'SYSTEM_ADMIN',
        username: 'playwright',
      },
    });
  });
  await page.route('**/api/v1/settings', async (route) => {
    if (route.request().method() === 'PATCH') {
      const input = route.request().postDataJSON() as typeof settings;
      expect(input).toEqual({
        dateTimeFormat: 'ISO',
        issueRetentionDays: 45,
        pullRequestRetentionDays: 60,
        workflowRunRetentionDays: 30,
      });
      await settingsUpdateResponse;
      settings = input;
    }
    await route.fulfill({ contentType: 'application/json', json: settings });
  });
  await page.route(/\/api\/v1\/users(?:\?.*)?$/, async (route) => {
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

  await page.goto('/admin/settings/system');

  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'General' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'MCP access' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'System' })).toHaveAttribute('aria-current', 'page');
  await expect
    .poll(() =>
      page.locator('[data-settings-page]').evaluate((element) => {
        const contentBounds = element.parentElement?.getBoundingClientRect();
        const pageBounds = element.getBoundingClientRect();
        const shellBounds = element.closest('[data-page-shell]')?.getBoundingClientRect();
        return Boolean(
          contentBounds &&
          shellBounds &&
          Math.abs(contentBounds.right - shellBounds.right) <= 1 &&
          pageBounds.width < contentBounds.width,
        );
      }),
    )
    .toBe(true);
  await expect(page.getByRole('spinbutton', { name: 'Workflow run retention' })).toHaveValue('90');
  await page.getByRole('spinbutton', { name: 'Workflow run retention' }).fill('30');
  await page.getByRole('spinbutton', { name: 'Closed issue retention' }).fill('45');
  await page.getByRole('spinbutton', { name: 'Closed pull request retention' }).fill('60');
  await page.getByRole('combobox', { name: 'Default date and time format' }).click();
  await page.getByRole('option', { name: 'ISO style' }).click();
  await expect(page.getByText('2026-09-09 13:05', { exact: true })).toBeVisible();

  const saveButton = page.getByRole('button', { name: 'Save settings' });
  await saveButton.click();
  await expect(saveButton).toBeDisabled();
  await expect(saveButton.locator('[data-slot="leadingIcon"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('global-settings-saving.png'), fullPage: true });
  releaseSettingsUpdate?.();
  await expect(page.getByText('Global settings saved.', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Users' }).click();
  await expect(page.locator('tbody')).toContainText('2026-09-08 10:00');
});

/** Let non-administrators manage personal preferences without exposing global settings. */
test('shows personal settings but hides global defaults from non-administrators', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('ezrepo.access-token', 'playwright-access-token'));
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: { firstName: null, id: 'playwright-viewer', lastName: null, role: 'VIEWER', username: 'viewer' },
    });
  });
  await page.route('**/api/v1/settings', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: { dateTimeFormat: 'LOCALE_MEDIUM', workflowRunRetentionDays: 90 },
    });
  });

  await page.goto('/admin/settings');

  await expect(page).toHaveURL('/admin/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'General' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'MCP access' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'System' })).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: 'Workflow run retention' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0);

  await page.goto('/admin/settings/system');
  await expect(page).toHaveURL('/');
});

/** Update personal names and protect a login-username change with the current password. */
test('updates personal details and refreshes the visible user identity', async ({ page }, testInfo) => {
  let currentUser = {
    avatarUpdatedAt: null,
    firstName: null as string | null,
    id: 'playwright-viewer',
    lastName: null as string | null,
    role: 'VIEWER',
    username: 'viewer',
  };
  let releaseUpdate: (() => void) | undefined;
  const updateGate = new Promise<void>((resolve) => {
    releaseUpdate = resolve;
  });
  await page.addInitScript(() => window.localStorage.setItem('ezrepo.access-token', 'playwright-access-token'));
  await page.route('**/api/v1/auth/me', async (route) => {
    if (route.request().method() === 'PATCH') {
      expect(route.request().postDataJSON()).toEqual({
        currentPassword: 'current-password',
        firstName: 'Vera',
        lastName: 'Viewer',
        username: 'vera',
      });
      await updateGate;
      currentUser = { ...currentUser, firstName: 'Vera', lastName: 'Viewer', username: 'vera' };
    }
    await route.fulfill({ contentType: 'application/json', json: currentUser });
  });
  await page.addInitScript(() => window.localStorage.setItem('ezrepo.access-token', 'old-access-token'));
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: user }));

  await page.goto('/admin/settings');
  await expect(page.getByRole('heading', { name: 'Change password' })).toBeVisible();
  await page.getByLabel('Current password').last().fill('current-password');
  await page.getByLabel('New password').fill('replacement-password');
  await page.getByLabel('Confirm password').fill('replacement-password');
  const saveButton = page.getByRole('button', { name: 'Change password' });
  await saveButton.click();
  await expect(saveButton).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('password-settings-saving.png'), fullPage: true });
  releaseUpdate?.();

  await expect(page.getByText('Password changed. Other sessions have been signed out.')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('ezrepo.access-token')))
    .toBe('replacement-access-token');
});

/** Upload, crop, and remove the current user's profile picture without exposing the original source. */
test('manages a cropped personal avatar from upload and HTTPS import', async ({ page }, testInfo) => {
  const currentUser = {
    avatarUpdatedAt: null as string | null,
    firstName: null,
    id: 'playwright-viewer',
    lastName: null,
    role: 'VIEWER',
    username: 'viewer',
  };
  const uploadCount = 0;
  await page.addInitScript(() => window.localStorage.setItem('ezrepo.access-token', 'playwright-access-token'));
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ contentType: 'application/json', json: currentUser }),
  );
  await page.route('**/api/v1/auth/me/avatar/remote-preview', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ url: 'https://example.com/avatar.png' });
    await route.fulfill({ body: nonSquarePng, contentType: 'image/png' });
  });
  await page.route('**/api/v1/users/playwright-viewer/avatar**', (route) =>
    route.fulfill({ body: nonSquarePng, contentType: 'image/webp' }),
  );

  await page.goto('/admin/settings');
  await page
    .locator('input[type="file"]')
    .setInputFiles({ buffer: nonSquarePng, mimeType: 'image/png', name: 'avatar.png' });
  const cropDialog = page.getByRole('dialog', { name: 'Crop profile picture' });
  await expect(cropDialog).toBeVisible();
  await expect(cropDialog.getByRole('button', { name: 'Zoom in' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('avatar-crop-dialog.png'), fullPage: true });
  await cropDialog.getByRole('button', { name: 'Apply crop' }).click();
  await expect(page.getByText('Profile picture updated.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove profile picture' })).toBeVisible();

  await page.getByPlaceholder('https://example.com/avatar.jpg').fill('https://example.com/avatar.png');
  await page.getByRole('button', { name: 'Import image' }).click();
  await expect(cropDialog).toBeVisible();
  await cropDialog.getByRole('button', { name: 'Apply crop' }).click();
  await expect.poll(() => uploadCount).toBe(2);

  await page.getByRole('button', { name: 'Remove profile picture' }).click();
  await expect(page.getByRole('button', { name: 'Remove profile picture' })).toHaveCount(0);
});
