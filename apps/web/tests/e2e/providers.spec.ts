import { expect, test } from '@playwright/test';

/** Verify the Query Kit provider table and its credential-validated add dialog. */
test('provider account table opens an add dialog with structured native controls', async ({ page }, testInfo) => {
  let releaseAuthenticationOptions: (() => void) | undefined;
  const authenticationOptionsResponse = new Promise<void>((resolve) => {
    releaseAuthenticationOptions = resolve;
  });
  let webhookConfigured = false;
  let webhookUpdateFails = false;
  let savedWebhookSecret = '';
  let releaseWebhookUpdate: (() => void) | undefined;
  const webhookUpdateResponse = new Promise<void>((resolve) => {
    releaseWebhookUpdate = resolve;
  });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => window.localStorage.setItem('ezrepo.access-token', 'playwright-access-token'));
  await page.route(/\/api\/v1\/provider-accounts(?:\?.*)?$/, async (route) => {
    expect(route.request().url()).toContain('fields=');
    expect(new URL(route.request().url()).searchParams.get('fields')).not.toContain('webhook');
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
  await page.route('**/api/v1/provider-accounts/webhook-configurations', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: [
        {
          callbackUrl: 'https://ezrepo.example.test/api/webhooks/github/provider-1',
          configured: webhookConfigured,
          lastDeliveryAt: webhookConfigured ? '2026-09-13T12:00:00.000Z' : null,
          providerAccountId: 'provider-1',
          providerType: 'GITHUB',
        },
      ],
    });
  });
  await page.route('**/api/v1/provider-accounts/provider-1', async (route) => {
    const body = route.request().postDataJSON() as { webhookSecret: string };
    savedWebhookSecret = body.webhookSecret;
    await webhookUpdateResponse;
    if (webhookUpdateFails) {
      await route.fulfill({ contentType: 'application/json', json: { message: 'failed' }, status: 500 });
      return;
    }
    webhookConfigured = true;
    await route.fulfill({
      contentType: 'application/json',
      json: {
        baseUrl: null,
        displayName: 'Production GitHub',
        enabled: true,
        id: 'provider-1',
        lastSyncAt: null,
        providerType: 'GITHUB',
      },
    });
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
  await expect(page.getByText('Not configured', { exact: true })).toBeVisible();
  await expect(page.locator('#main-content [class~="i-tabler:brand-github"]')).toBeVisible();
  await expect(page.getByRole('button', { name: /add provider|anbieter hinzufügen/i })).toBeVisible();
  await page.getByRole('button', { name: 'Disable' }).hover();
  await expect(page.locator('[data-slot="content"][data-side]').filter({ hasText: 'Disable' })).toBeVisible();
  await page.mouse.move(0, 0);
  await page.getByRole('button', { name: 'Delete' }).hover();
  await expect(page.locator('[data-slot="content"][data-side]').filter({ hasText: 'Delete' })).toBeVisible();

  await page.getByRole('button', { name: 'Configure webhook' }).click();
  const webhookDialog = page.getByRole('dialog', { name: 'Webhook for Production GitHub' });
  await expect(webhookDialog.getByRole('heading', { name: 'Webhook for Production GitHub' })).toBeVisible();
  await expect(page.locator('input[value="https://ezrepo.example.test/api/webhooks/github/provider-1"]')).toBeVisible();
  await expect(page.getByText(/Workflow runs \(workflow_run\)/)).toBeVisible();
  await expect(webhookDialog.getByText('Never', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('provider-webhook-dialog-dark.png'), fullPage: true });

  await page.getByRole('button', { name: 'Generate secret' }).click();
  const secretInput = page.getByRole('textbox', { name: 'Signing secret' });
  await expect(secretInput).toHaveValue(/^[A-Za-z0-9+/]{43}=$/);
  await page.getByRole('button', { name: 'Copy secret' }).click();
  await expect(page.getByRole('button', { name: 'Copy secret' }).locator('[class~="i-lucide:check"]')).toBeVisible();
  await page.getByRole('button', { name: 'Save secret' }).click();
  await expect(page.getByRole('button', { name: 'Save secret' })).toBeDisabled();
  expect(savedWebhookSecret).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  releaseWebhookUpdate?.();
  await expect(page.getByText('Webhook secret saved')).toBeVisible();
  await expect(page.getByText('Configured', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rotate secret' })).toBeDisabled();
  await expect(page.getByText('Existing webhooks require an update')).toBeVisible();
  await secretInput.fill('manually-provided-token');
  await expect(secretInput).toHaveValue('manually-provided-token');
  await page.getByText('I will update every provider webhook with the new secret.').click();
  await expect(page.getByRole('button', { name: 'Rotate secret' })).toBeEnabled();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'playwright' }).click();
  await expect(page.getByText('Language', { exact: true })).toBeVisible();
  await expect(page.getByText('Theme', { exact: true })).toBeVisible();
  await page.getByText('Theme', { exact: true }).click();
  await expect(page.getByText('System', { exact: true })).toBeVisible();
  await expect(page.getByText('Light', { exact: true })).toBeVisible();
  await expect(page.getByText('Dark', { exact: true })).toBeVisible();
  await page.getByText('Light', { exact: true }).click();
  await page.setViewportSize({ height: 844, width: 390 });
  await page.getByRole('button', { name: 'Configure webhook' }).click();
  await expect(webhookDialog).toBeVisible();
  await expect(webhookDialog.getByRole('heading', { name: 'Webhook for Production GitHub' })).toBeVisible();
  await expect(webhookDialog.getByRole('textbox', { name: 'Signing secret' })).toHaveValue('');
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('provider-webhook-dialog-light-mobile.png'),
    fullPage: true,
  });
  await webhookDialog.getByRole('textbox', { name: 'Signing secret' }).fill('replacement-token');
  await webhookDialog.getByText('I will update every provider webhook with the new secret.').click();
  webhookUpdateFails = true;
  await webhookDialog.getByRole('button', { name: 'Rotate secret' }).click();
  await expect(webhookDialog.getByText('The webhook secret could not be saved.')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ height: 900, width: 1440 });

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
