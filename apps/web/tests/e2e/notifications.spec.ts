import { expect, test, type Page } from '@playwright/test';

const pageMeta = { hasNextPage: false, hasPrevPage: false, itemCount: 1, page: 1, pageCount: 1, perPage: 10 };

async function mockShell(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('ezrepo.access-token', 'playwright-access-token'));
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      json: {
        avatarUpdatedAt: null,
        firstName: null,
        id: 'user-1',
        lastName: null,
        role: 'SYSTEM_ADMIN',
        username: 'admin',
      },
    }),
  );
  await page.route('**/api/v1/health', (route) =>
    route.fulfill({ json: { api: 'ok', database: 'ok', providers: [], status: 'ok' } }),
  );
  await page.route('**/api/v1/version/latest', (route) => route.fulfill({ json: { latest: null } }));
  await page.route('**/api/v1/settings', (route) =>
    route.fulfill({ json: { dateTimeFormat: 'LOCALE_MEDIUM', workflowRunRetentionDays: 90 } }),
  );
  await page.route('**/api/v1/dashboard/**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/browser-push', (route) =>
    route.fulfill({ json: { available: false, publicKey: null, subscriptionCount: 0 } }),
  );
  await page.route('**/api/v1/notification-channels/manageable-repositories', (route) =>
    route.fulfill({ json: [{ id: 'repository-1', name: 'ezrepo', owner: 'tobiaswaelde' }] }),
  );
}

test('navigates channel, rule and delivery-history tables', async ({ page }) => {
  await mockShell(page);
  await page.route('**/api/v1/notification-channels/query**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            browserRecipientUserId: null,
            browserRecipientUsername: null,
            canManage: true,
            createdAt: '2026-09-13T10:00:00Z',
            enabled: true,
            id: 'channel-1',
            name: 'Operations',
            repositoryId: 'repository-1',
            repositoryName: 'ezrepo',
            repositoryOwner: 'tobiaswaelde',
            requiresReconfiguration: false,
            type: 'GOTIFY',
            updatedAt: '2026-09-13T10:00:00Z',
            urlScheme: 'gotifys',
          },
        ],
        meta: pageMeta,
      },
    }),
  );
  await page.route('**/api/v1/notification-rules/query**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            canManage: true,
            channelIds: ['channel-1'],
            channels: [{ id: 'channel-1', name: 'Operations', type: 'GOTIFY' }],
            createdAt: '2026-09-13T10:00:00Z',
            enabled: true,
            id: 'rule-1',
            outcome: 'FAILED',
            repositoryId: 'repository-1',
            repositoryName: 'ezrepo',
            repositoryOwner: 'tobiaswaelde',
            updatedAt: '2026-09-13T10:00:00Z',
            workflowPattern: 'deploy-*',
          },
        ],
        meta: pageMeta,
      },
    }),
  );
  await page.route('**/api/v1/notification-deliveries/query**', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            attempts: [
              {
                attempt: 1,
                browserPushSubscriptionId: null,
                createdAt: '2026-09-13T10:00:00Z',
                deliveredAt: null,
                deviceLabel: null,
                error: 'Apprise notification delivery failed.',
                id: 'attempt-1',
                notificationChannelId: 'channel-1',
                notificationChannelName: 'Operations',
                notificationChannelType: 'GOTIFY',
              },
            ],
            createdAt: '2026-09-13T10:00:00Z',
            finalError: 'One or more notification channels failed.',
            id: 'delivery-1',
            kind: 'WORKFLOW_RUN',
            nextAttemptAt: null,
            notificationRuleId: 'rule-1',
            outcome: 'FAILED',
            repositoryId: 'repository-1',
            repositoryName: 'ezrepo',
            repositoryOwner: 'tobiaswaelde',
            requestedByUsername: null,
            status: 'FAILED',
            testChannelName: null,
            updatedAt: '2026-09-13T10:00:00Z',
            workflowName: 'deploy-production',
            workflowPattern: 'deploy-*',
            workflowRunId: 'run-1',
            workflowUrl: 'https://example.com/run/1',
          },
        ],
        meta: pageMeta,
      },
    }),
  );

  await page.goto('/notifications');
  await expect(page.getByRole('link', { name: 'Channels', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Operations' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Gotify', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Rules', exact: true }).click();
  await expect(page.getByText('deploy-*')).toBeVisible();

  await page.getByRole('link', { name: 'Delivery history', exact: true }).click();
  await expect(page.getByText('deploy-production')).toBeVisible();
  await page.getByRole('button', { name: 'View delivery details' }).click();
  await expect(page.getByRole('dialog', { name: 'Delivery details' })).toContainText(
    'Apprise notification delivery failed.',
  );
  await page.setViewportSize({ height: 844, width: 390 });
  await expect(page.getByRole('dialog', { name: 'Delivery details' })).toBeVisible();
});
