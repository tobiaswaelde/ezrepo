import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ForgejoActionsAdapter, ForgejoActionsUnsupportedError } from './forgejo-actions.adapter.js';

const fixtureDirectory = resolve(__dirname, 'fixtures');
const readFixture = (name: string): unknown => JSON.parse(readFileSync(resolve(fixtureDirectory, name), 'utf8'));

describe('ForgejoActionsAdapter', () => {
  const context = { accessToken: 'token', baseUrl: 'https://forgejo.example.test', providerAccountId: 'account' };

  it('retains Forgejo rate-limit timing without exposing the response body', async () => {
    const adapter = new ForgejoActionsAdapter(
      jest.fn().mockResolvedValue(new Response('sensitive', { headers: { 'retry-after': '60' }, status: 429 })),
    );

    await expect(adapter.listRepositories(context)).rejects.toMatchObject({
      message: 'Forgejo API request failed with status 429.',
      retryAt: expect.any(Date),
      status: 429,
    });
  });
  it('maps Actions workflow runs through the read-only API', async () => {
    const fetchFn = jest.fn().mockResolvedValue(new Response(JSON.stringify(readFixture('workflow-runs.json'))));
    await expect(
      new ForgejoActionsAdapter(fetchFn).listWorkflowRuns(context, {
        providerRepositoryId: '1',
        owner: 'org',
        name: 'repo',
      }),
    ).resolves.toMatchObject([
      {
        awaitingApproval: false,
        changeRequestNumber: '42',
        displayTitle: 'Fix Forgejo synchronization',
        durationMs: 120_000,
        headBranch: 'feature/forgejo',
        headSha: '0123456789abcdef',
        providerRunId: '7',
        providerWorkflowId: 'ci.yml',
        scopeKey: 'change-request:42',
        status: 'SUCCESS',
        workflowName: 'ci',
        workflowPath: '.forgejo/workflows/ci.yml',
      },
    ]);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://forgejo.example.test/api/v1/repos/org/repo/actions/runs?page=1&limit=100',
      expect.anything(),
    );
  });

  it('maps native approval state and duration when Forgejo has not started the run', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          total_count: 1,
          workflow_runs: [
            {
              created: '2026-08-01T10:00:00Z',
              duration: 3_000_000_000,
              event: 'pull_request',
              event_payload: '{not-json',
              html_url: 'https://forgejo.example.test/org/repo/actions/runs/8',
              id: 8,
              need_approval: true,
              prettyref: '#43',
              status: 'waiting',
              title: 'Await approval',
              updated: '2026-08-01T10:00:03Z',
              workflow_id: 'approval.yaml',
            },
          ],
        }),
      ),
    );

    await expect(
      new ForgejoActionsAdapter(fetchFn).listWorkflowRuns(context, {
        providerRepositoryId: '1',
        owner: 'org',
        name: 'repo',
      }),
    ).resolves.toMatchObject([
      {
        awaitingApproval: true,
        changeRequestNumber: null,
        durationMs: 3_000,
        headBranch: '#43',
        reviewUrl: 'https://forgejo.example.test/org/repo/actions/runs/8',
        status: 'QUEUED',
      },
    ]);
  });

  it('paginates incremental runs until reaching the last synchronization time', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      created: '2026-08-01T10:00:00Z',
      html_url: `https://forgejo.example.test/org/repo/actions/runs/${index + 1}`,
      id: index + 1,
      status: 'success',
      updated: '2026-08-01T10:05:00Z',
      workflow_id: 'ci.yml',
    }));
    const secondPage = [
      {
        created: '2026-08-01T09:00:00Z',
        html_url: 'https://forgejo.example.test/org/repo/actions/runs/101',
        id: 101,
        status: 'success',
        updated: '2026-08-01T09:05:00Z',
        workflow_id: 'ci.yml',
      },
    ];
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ total_count: 101, workflow_runs: firstPage })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total_count: 101, workflow_runs: secondPage })));

    await expect(
      new ForgejoActionsAdapter(fetchFn).listWorkflowRuns(
        context,
        { providerRepositoryId: '1', owner: 'org', name: 'repo' },
        new Date('2026-08-01T10:00:00Z'),
      ),
    ).resolves.toHaveLength(100);
    expect(fetchFn).toHaveBeenNthCalledWith(2, expect.stringContaining('page=2&limit=100'), expect.anything());
  });
  it('loads current repository metadata through the stable Forgejo repository ID', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 1,
          name: 'renamed',
          html_url: 'https://forgejo.example.test/new-org/renamed',
          owner: { login: 'new-org' },
        }),
      ),
    );
    await expect(
      new ForgejoActionsAdapter(fetchFn).getRepository(context, {
        providerRepositoryId: '1',
        owner: 'org',
        name: 'repo',
      }),
    ).resolves.toMatchObject({ providerRepositoryId: '1', owner: 'new-org', name: 'renamed' });
    expect(fetchFn).toHaveBeenCalledWith(expect.stringContaining('/api/v1/repositories/1'), expect.anything());
  });
  it('explains when a Forgejo server has no Actions run API', async () => {
    const adapter = new ForgejoActionsAdapter(jest.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(
      adapter.listWorkflowRuns(context, { providerRepositoryId: '1', owner: 'org', name: 'repo' }),
    ).rejects.toBeInstanceOf(ForgejoActionsUnsupportedError);
  });
  it('verifies Forgejo HMAC signatures while retaining Gitea header compatibility', async () => {
    const adapter = new ForgejoActionsAdapter();
    const payload = Buffer.from(JSON.stringify(readFixture('webhook.json')));
    const signature = createHmac('sha256', 'webhook-secret').update(payload).digest('hex');

    await expect(
      adapter.verifyWebhook({
        headers: {
          'x-forgejo-event': 'push',
          'x-forgejo-signature': signature,
        },
        payload,
        signingSecret: 'webhook-secret',
      }),
    ).resolves.toEqual({
      event: 'push',
      providerRepositoryId: '42',
      syncScopes: ['WORKFLOWS', 'ISSUES', 'PULL_REQUESTS'],
    });
  });
});

describe('ForgejoActionsAdapter change requests', () => {
  const context = { accessToken: 'token', baseUrl: 'https://forgejo.example.test', providerAccountId: 'account' };
  const repository = { name: 'ezrepo', owner: 'octo', providerRepositoryId: '1' };

  it.each([
    ['open', false, null, 'OPEN'],
    ['closed', false, null, 'CLOSED'],
    ['closed', true, '2026-09-12T10:00:00.000Z', 'MERGED'],
  ] as const)(
    'normalizes a %s pull request with merged=%s and merged-at %s as %s',
    async (state, merged, mergedAt, expected) => {
      const adapter = new ForgejoActionsAdapter(
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

  it('normalizes Forgejo issue and pull-request fixtures', async () => {
    const adapter = new ForgejoActionsAdapter(
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
    const adapter = new ForgejoActionsAdapter(jest.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(adapter.getChangeRequestState(context, repository, '42')).resolves.toBeNull();
  });
});
