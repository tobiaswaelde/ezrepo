import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

const serviceWorkerPath = resolve(process.cwd(), '.output/public/sw.js');
let originalServiceWorker = '';

test.beforeAll(async () => {
  originalServiceWorker = await readFile(serviceWorkerPath, 'utf8');
});

test.afterAll(async () => {
  await writeFile(serviceWorkerPath, originalServiceWorker);
});

/** Keep unauthenticated routing stable while exercising the production client. */
async function mockSetupStatus(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/api/v1/auth/setup-status', (route) => route.fulfill({ json: { initialized: true } }));
}

test('publishes an installable manifest without caching protected application data', async ({ page }) => {
  await mockSetupStatus(page);
  await page.goto('/auth/signin');

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0891b2');
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon-180x180.png');

  const manifestResponse = await page.request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  expect(manifestResponse.headers()['content-type']).toContain('application/manifest+json');
  const manifest = (await manifestResponse.json()) as {
    display: string;
    icons: { purpose?: string; sizes: string; src: string; type: string }[];
    name: string;
    scope: string;
    start_url: string;
  };
  expect(manifest).toMatchObject({ display: 'standalone', name: 'ezRepo', scope: '/', start_url: '/' });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', type: 'image/png' }),
      expect.objectContaining({ sizes: '512x512', type: 'image/png' }),
      expect.objectContaining({ purpose: 'maskable', sizes: '512x512', type: 'image/png' }),
    ]),
  );
  for (const icon of manifest.icons) expect((await page.request.get(icon.src)).ok()).toBe(true);

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return registration.active?.state;
      }),
    )
    .toBe('activated');

  const chromiumSession = await page.context().newCDPSession(page);
  const { installabilityErrors } = await chromiumSession.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);

  const cachedUrls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const cacheName of await caches.keys()) {
      for (const request of await (await caches.open(cacheName)).keys()) urls.push(request.url);
    }
    return urls;
  });
  expect(cachedUrls.length).toBeGreaterThan(0);
  expect(cachedUrls.some((url) => /\/api(?:\/|$)|\/socket\.io(?:\/|$)/.test(new URL(url).pathname))).toBe(false);
});

test('offers a controlled choice when a new service worker is waiting', async ({ page }) => {
  await mockSetupStatus(page);
  await page.goto('/auth/signin');
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state ?? null)).toBe('activated');

  await writeFile(serviceWorkerPath, `${originalServiceWorker}\n// browser-test-update\n`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js?browser-test-update', { scope: '/', updateViaCache: 'none' });
  });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return registration?.waiting?.state ?? registration?.installing?.state ?? null;
      }),
    )
    .toBe('installed');

  const prompt = page.locator('[data-pwa-update-prompt]');
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: 'Later' }).click();
  await expect(prompt).toBeHidden();

  await page.reload();
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: 'Update' }).click();
  await expect(page).toHaveURL(/\/auth\/signin$/);
  await expect(prompt).toBeHidden();
});
