import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { GiteaActionsAdapter, GiteaActionsUnsupportedError } from './gitea-actions.adapter.js';

const fixtureDirectory = resolve(__dirname, 'fixtures');

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixtureDirectory, name), 'utf8'));
}

describe('GiteaActionsAdapter', () => {
  const context = { accessToken: 'token', baseUrl: 'https://gitea.example.test', providerAccountId: 'account' };
  const repository = { providerRepositoryId: '42', owner: 'ezrepo', name: 'ezrepo' };

  it('retains Gitea rate-limit timing without exposing the response body', async () => {
    const adapter = new GiteaActionsAdapter(
      jest.fn().mockResolvedValue(new Response('sensitive', { headers: { 'retry-after': '60' }, status: 429 })),
    );

    await expect(adapter.listRepositories(context)).rejects.toMatchObject({
      message: 'Gitea API request failed with status 429.',
      retryAt: expect.any(Date),
      status: 429,
    });
  });

  it('discovers repositories and maps Actions workflow runs from recorded read-only API fixtures', async () => {
    const fetchFn = jest.fn(async (url: string) => {
      if (url.endsWith('/user')) return new Response(JSON.stringify(readFixture('user.json')));
      if (url.includes('/user/repos')) return new Response(JSON.stringify(readFixture('repositories.json')));
      if (url.endsWith('/repositories/42'))
        return new Response(JSON.stringify((readFixture('repositories.json') as unknown[])[0]));
      if (url.includes('/actions/runs?')) return new Response(JSON.stringify(readFixture('workflow-runs.json')));
      if (url.endsWith('/actions/runs/7')) return new Response(JSON.stringify(readFixture('workflow-run.json')));
      throw new Error(`Unexpected request: ${url}`);
    });
    const adapter = new GiteaActionsAdapter(fetchFn);

    await expect(adapter.validateAccount(context)).resolves.toEqual({ displayName: 'ezrepo-bot', valid: true });
    await expect(adapter.listRepositories(context)).resolves.toEqual([
      {
        providerRepositoryId: '42',
        owner: 'ezrepo',
        name: 'ezrepo',
        url: 'https://gitea.example.test/ezrepo/ezrepo',
      },
    ]);
    await expect(adapter.getRepository(context, repository)).resolves.toMatchObject({ providerRepositoryId: '42' });
    await expect(adapter.listWorkflowRuns(context, repository)).resolves.toMatchObject([
      {
        providerRunId: '7',
        workflowName: 'CI',
        status: 'SUCCESS',
        durationMs: 120_000,
      },
    ]);
    await expect(adapter.getWorkflowRun(context, repository, '7')).resolves.toMatchObject({
      providerRunId: '7',
      status: 'SUCCESS',
    });
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });

  it('paginates more than 100 incremental workflow runs', async () => {
    const workflowRun = (id: number) => ({
      completed_at: '2026-09-13T10:01:00Z',
      created_at: '2026-09-13T10:00:00Z',
      html_url: `https://gitea.example.test/ezrepo/ezrepo/actions/runs/${id}`,
      id,
      name: 'CI',
      status: 'success',
      updated_at: '2026-09-13T10:01:00Z',
      workflow_id: 17,
    });
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total_count: 101,
            workflow_runs: Array.from({ length: 100 }, (_, index) => workflowRun(index)),
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ total_count: 101, workflow_runs: [workflowRun(100)] })));

    await expect(
      new GiteaActionsAdapter(fetchFn).listWorkflowRuns(context, repository, new Date('2026-09-13T09:00:00Z')),
    ).resolves.toHaveLength(101);
    expect(fetchFn).toHaveBeenNthCalledWith(2, expect.stringContaining('limit=100&page=2'), expect.anything());
  });

  it('reports unsupported Actions servers without attempting a provider write', async () => {
    const adapter = new GiteaActionsAdapter(jest.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(adapter.listWorkflowRuns(context, repository)).rejects.toBeInstanceOf(GiteaActionsUnsupportedError);
  });

  it('validates a recorded Gitea webhook using the raw JSON payload', async () => {
    const payload = Buffer.from(JSON.stringify(readFixture('webhook.json')));
    const signature = createHmac('sha256', 'webhook-secret').update(payload).digest('hex');
    const adapter = new GiteaActionsAdapter();

    await expect(
      adapter.verifyWebhook({
        headers: { 'x-gitea-event': 'workflow_run', 'x-gitea-signature': signature },
        payload,
        signingSecret: 'webhook-secret',
      }),
    ).resolves.toEqual({ event: 'workflow_run', providerRepositoryId: '42', syncScopes: ['WORKFLOWS'] });
  });
});

describe('GiteaActionsAdapter change requests', () => {
  const context = { accessToken: 'token', baseUrl: 'https://gitea.example.test', providerAccountId: 'account' };
  const repository = { name: 'ezrepo', owner: 'octo', providerRepositoryId: '1' };

  it.each([
    ['open', false, null, 'OPEN'],
    ['closed', false, null, 'CLOSED'],
    ['closed', true, '2026-09-12T10:00:00.000Z', 'MERGED'],
  ] as const)(
    'normalizes a %s pull request with merged=%s and merged-at %s as %s',
    async (state, merged, mergedAt, expected) => {
      const adapter = new GiteaActionsAdapter(
        jest
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ base: { ref: 'main' }, merged, merged_at: mergedAt, state })),
          ),
      );

      await expect(adapter.getChangeRequestState(context, repository, '42')).resolves.toEqual({
        mergedAt: mergedAt ? new Date(mergedAt) : null,
        state: expected,
        targetBranch: 'main',
      });
    },
  );

  it('normalizes Gitea issue and pull-request fixtures', async () => {
    const adapter = new GiteaActionsAdapter(
      jest
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(readFixture('issues.json'))))
        .mockResolvedValueOnce(new Response(JSON.stringify(readFixture('pull-requests.json')))),
    );
    const query = { includeAllOpen: false, updatedAfter: new Date('2026-08-01T00:00:00Z') };
    await expect(adapter.listIssues(context, repository, query)).resolves.toMatchObject([
      { labels: [{ name: 'bug' }], number: '7', state: 'OPEN' },
    ]);
    await expect(adapter.listPullRequests(context, repository, query)).resolves.toMatchObject([
      { number: '8', sourceBranch: 'feature/work', targetBranch: 'main' },
    ]);
  });

  it('returns null when the pull request is unavailable', async () => {
    const adapter = new GiteaActionsAdapter(jest.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(adapter.getChangeRequestState(context, repository, '42')).resolves.toBeNull();
  });
});
