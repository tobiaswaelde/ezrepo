import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';

const accessToken = 'playwright-access-token';

/** Configure the authenticated dashboard shell required by the global status bar. */
async function mockDashboardShell(page: Page): Promise<void> {
  await page.addInitScript((token) => window.localStorage.setItem('ezrepo.access-token', token), accessToken);
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ json: { id: 'playwright', role: 'VIEWER', username: 'playwright' } }),
  );
  await page.route('**/api/v1/dashboard/failures', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/dashboard/latest-runs', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/dashboard/trend**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/jobs/repository-sync/summary', (route) =>
    route.fulfill({ json: { failed: 0, idle: 0, pending: 0, running: 0, total: 0 } }),
  );
  await page.route(/\/api\/v1\/jobs\/repository-sync(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: [],
        meta: { hasNextPage: false, hasPrevPage: false, itemCount: 0, page: 1, pageCount: 0, perPage: 10 },
      },
    }),
  );
}

/** Encode a Socket.IO event for the status namespace. */
function statusEvent(snapshot: object): string {
  return `42/status,${JSON.stringify(['system-status', snapshot])}`;
}

test('shows live workflow counts and provider synchronization progress globally', async ({ page }) => {
  await mockDashboardShell(page);
  let socket: WebSocketRoute | undefined;
  let namespaceAuthentication = '';
  await page.routeWebSocket(/\/socket\.io\//, (route) => {
    socket = route;
    route.send(
      `0${JSON.stringify({ maxPayload: 1_000_000, pingInterval: 25_000, pingTimeout: 20_000, sid: 'status-test', upgrades: [] })}`,
    );
    route.onMessage((message) => {
      const packet = message.toString();
      if (packet === '2') route.send('3');
      if (!packet.startsWith('40/status,')) return;
      namespaceAuthentication = packet;
      route.send('40/status,{"sid":"status-client"}');
      route.send(
        statusEvent({
          activity: {
            kind: 'PROVIDER_SYNC',
            phase: 'FETCHING_WORKFLOWS',
            repositoriesCompleted: 1,
            repositoriesTotal: 4,
            workflowRunsCompleted: null,
            workflowRunsTotal: null,
          },
          runningWorkflowCount: 3,
          updatedAt: '2026-09-09T08:00:00.000Z',
        }),
      );
    });
  });

  await page.goto('/');

  const statusBar = page.getByLabel('API status');
  await expect(statusBar).toBeVisible();
  const statusBarBox = await statusBar.boundingBox();
  const dashboardPanelBox = await page.locator('#ezrepo-panel-main').boundingBox();
  const sidebarBox = await page.getByRole('complementary', { name: 'Sidebar navigation' }).boundingBox();
  expect(statusBarBox).not.toBeNull();
  expect(dashboardPanelBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  expect(Math.round(statusBarBox?.x ?? 0)).toBe(Math.round((sidebarBox?.x ?? 0) + (sidebarBox?.width ?? 0)));
  expect(Math.round(statusBarBox?.x ?? 0)).toBe(Math.round(dashboardPanelBox?.x ?? 0));
  expect(Math.round(statusBarBox?.width ?? 0)).toBe(Math.round(dashboardPanelBox?.width ?? 0));
  expect(Math.round(statusBarBox?.y ?? 0)).toBe(
    Math.round((dashboardPanelBox?.y ?? 0) + (dashboardPanelBox?.height ?? 0)),
  );
  expect(Math.round((statusBarBox?.y ?? 0) + (statusBarBox?.height ?? 0))).toBe(900);
  await expect(statusBar).toContainText('Live');
  await expect(statusBar).toContainText('Running: 3');
  await expect(statusBar).toContainText('Fetching workflows from provider');
  await expect(statusBar).toContainText('1/4');
  await expect.poll(() => namespaceAuthentication).toContain(`"token":"${accessToken}"`);

  socket?.send(
    statusEvent({
      activity: {
        kind: 'PROVIDER_SYNC',
        phase: 'PROCESSING_WORKFLOWS',
        repositoriesCompleted: 1,
        repositoriesTotal: 4,
        workflowRunsCompleted: 7,
        workflowRunsTotal: 12,
      },
      runningWorkflowCount: 4,
      updatedAt: '2026-09-09T08:00:01.000Z',
    }),
  );

  await expect(statusBar).toContainText('Running: 4');
  await expect(statusBar).toContainText('Processing workflows');
  await expect(statusBar).toContainText('7/12');
  const runningLink = statusBar.getByRole('link', { name: 'Open jobs. Running: 4' });
  await expect(runningLink).toHaveAttribute('href', '/jobs');
  await runningLink.click();
  await expect(page).toHaveURL(/\/jobs$/);
});

test('refreshes an open workflow-run table once after provider synchronization becomes idle', async ({ page }) => {
  await mockDashboardShell(page);
  let socket: WebSocketRoute | undefined;
  let workflowRunRequests = 0;
  await page.route('**/api/v1/repositories**', (route) =>
    route.fulfill({
      json: {
        items: [],
        meta: { hasNextPage: false, hasPrevPage: false, itemCount: 0, page: 1, pageCount: 0, perPage: 100 },
      },
    }),
  );
  await page.route(/\/api\/v1\/workflow-runs(?:\?.*)?$/, (route) => {
    workflowRunRequests += 1;
    return route.fulfill({
      json: {
        items:
          workflowRunRequests > 1
            ? [
                {
                  completedAt: null,
                  displayTitle: 'Webhook-triggered run',
                  durationMs: null,
                  id: 'run-1',
                  providerCreatedAt: '2026-09-13T12:00:00.000Z',
                  providerType: 'GITHUB',
                  repositoryName: 'ezrepo',
                  repositoryOwner: 'tobiaswaelde',
                  startedAt: '2026-09-13T12:00:00.000Z',
                  status: 'RUNNING',
                  url: 'https://github.com/tobiaswaelde/ezrepo/actions/runs/1',
                  workflowName: 'Test',
                },
              ]
            : [],
        meta: { hasNextPage: false, hasPrevPage: false, itemCount: 1, page: 1, pageCount: 1, perPage: 25 },
      },
    });
  });
  await page.routeWebSocket(/\/socket\.io\//, (route) => {
    socket = route;
    route.send(
      `0${JSON.stringify({ maxPayload: 1_000_000, pingInterval: 25_000, pingTimeout: 20_000, sid: 'refresh-test', upgrades: [] })}`,
    );
    route.onMessage((message) => {
      const packet = message.toString();
      if (packet === '2') route.send('3');
      if (!packet.startsWith('40/status,')) return;
      route.send('40/status,{"sid":"status-client"}');
      route.send(statusEvent({ activity: null, runningWorkflowCount: 0, updatedAt: '2026-09-13T12:00:00.000Z' }));
    });
  });

  await page.goto('/workflow-runs');
  await expect.poll(() => workflowRunRequests).toBe(1);

  socket?.send(
    statusEvent({
      activity: {
        kind: 'PROVIDER_SYNC',
        phase: 'FETCHING_WORKFLOWS',
        repositoriesCompleted: 0,
        repositoriesTotal: 1,
        workflowRunsCompleted: null,
        workflowRunsTotal: null,
      },
      runningWorkflowCount: 1,
      updatedAt: '2026-09-13T12:00:01.000Z',
    }),
  );
  socket?.send(statusEvent({ activity: null, runningWorkflowCount: 1, updatedAt: '2026-09-13T12:00:02.000Z' }));
  socket?.send(
    statusEvent({
      activity: {
        kind: 'PROVIDER_SYNC',
        phase: 'PROCESSING_WORKFLOWS',
        repositoriesCompleted: 0,
        repositoriesTotal: 1,
        workflowRunsCompleted: 1,
        workflowRunsTotal: 1,
      },
      runningWorkflowCount: 1,
      updatedAt: '2026-09-13T12:00:03.000Z',
    }),
  );
  socket?.send(statusEvent({ activity: null, runningWorkflowCount: 1, updatedAt: '2026-09-13T12:00:04.000Z' }));

  await expect(page.getByText('Webhook-triggered run')).toBeVisible();
  await expect.poll(() => workflowRunRequests).toBe(2);
});
