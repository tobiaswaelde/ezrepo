import { expect, test } from '@playwright/test';

/** Verify the Query Kit provider table and its credential-validated add dialog. */
test('provider account table opens an add dialog with structured native controls', async ({ page }, testInfo) => {
  let releaseAuthenticationOptions: (() => void) | undefined;
  const authenticationOptionsResponse = new Promise<void>((resolve) => {
    releaseAuthenticationOptions = resolve;
  });
  await page.addInitScript(() => window.localStorage.setItem('ezrepo.access-token', 'playwright-access-token'));
  await page.route(/\/api\/v1\/provider-accounts(?:\?.*)?$/, async (route) => {
    expect(route.request().url()).toContain('fields=');
    await route.fulfill({
      contentType: 'application/json',
      json: {
        items: [
          {
            baseUrl: null,
            displayName: 'Production GitHub',
            enabled: true,
            id: 'provider-1',
            lastSyncAt: null,
            providerType: 'GITHUB',
          },
        ],
        meta: { itemCount: 1, pageCount: 1 },
      },
    });
  });
  await page.route('**/api/v1/provider-accounts/authentication-options', async (route) => {
    await authenticationOptionsResponse;
    await route.fulfill({ contentType: 'application/json', json: { oauthProviderTypes: [] } });
  });
  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: { id: 'playwright-admin', role: 'SYSTEM_ADMIN', username: 'playwright' },
    });
  });

  await page.goto('/admin/providers');

  const breadcrumb = page.getByRole('navigation', { name: 'breadcrumb' });
  await expect(breadcrumb).toContainText('Dashboard');
  await expect(breadcrumb).toContainText('Provider accounts');
  await expect(breadcrumb.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/');
  await expect(breadcrumb.locator('[class~="i-lucide:layout-dashboard"]')).toBeVisible();
  await expect(breadcrumb.locator('[class~="i-lucide:plug-zap"]')).toBeVisible();
  await expect(page.getByText('Production GitHub')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Webhook' })).toHaveCount(0);
  await expect(page.locator('#main-content [class~="i-tabler:brand-github"]')).toBeVisible();
  await expect(page.getByRole('button', { name: /add provider|anbieter hinzufügen/i })).toBeVisible();
  await page.getByRole('button', { name: 'Disable' }).hover();
  await expect(page.locator('[data-slot="content"][data-side]').filter({ hasText: 'Disable' })).toBeVisible();
  await page.mouse.move(0, 0);
  await page.getByRole('button', { name: 'Delete' }).hover();
  await expect(page.locator('[data-slot="content"][data-side]').filter({ hasText: 'Delete' })).toBeVisible();

  await page.getByRole('button', { name: 'playwright' }).click();
  await expect(page.getByText('Language', { exact: true })).toBeVisible();
  await expect(page.getByText('Theme', { exact: true })).toBeVisible();
  await page.getByText('Theme', { exact: true }).click();
  await expect(page.getByText('System', { exact: true })).toBeVisible();
  await expect(page.getByText('Light', { exact: true })).toBeVisible();
  await expect(page.getByText('Dark', { exact: true })).toBeVisible();
  await page.getByText('Light', { exact: true }).click();
  await page.keyboard.press('Shift+O');
  await expect(page.getByText('Table options', { exact: true })).toBeVisible();
  await page.keyboard.press('Shift+O');

  await page.keyboard.press('Shift+N');

  await expect(page.getByRole('heading', { name: /add provider account|anbieter-konto hinzufügen/i })).toBeVisible();
  const submitButton = page.getByRole('button', { name: 'Verify and add provider' });
  await expect(submitButton).toBeDisabled();
  await expect(submitButton.locator('[data-slot="leadingIcon"]')).toBeVisible();
  releaseAuthenticationOptions?.();
  await expect(submitButton).toBeEnabled();
  await expect(page.getByPlaceholder(/production github|produktion github/i)).toBeVisible();
  await expect(page.getByRole('combobox').first()).toBeVisible();
  await expect(page.getByPlaceholder(/read-only token|schreibgeschützten token/i)).toBeVisible();
  await expect(page.getByPlaceholder('https://provider.example.com')).toBeVisible();

  await page.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'Gitea' }).click();

  await expect(page.getByRole('option', { name: 'Gitea' })).not.toBeVisible();
  await expect(page.getByPlaceholder('https://provider.example.com')).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath('provider-account-form.png'), fullPage: true });
});
