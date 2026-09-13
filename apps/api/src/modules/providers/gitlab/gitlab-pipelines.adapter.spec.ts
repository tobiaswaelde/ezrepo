import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { GitLabPipelinesAdapter } from './gitlab-pipelines.adapter.js';

const fixtureDirectory = resolve(__dirname, 'fixtures');
const readFixture = (name: string): unknown => JSON.parse(readFileSync(resolve(fixtureDirectory, name), 'utf8'));

describe('GitLabPipelinesAdapter', () => {
  const context = { accessToken: 'token', baseUrl: 'https://gitlab.example.test', providerAccountId: 'account' };

  it('retains GitLab rate-limit timing without exposing the response body', async () => {
    const adapter = new GitLabPipelinesAdapter(
      jest.fn().mockResolvedValue(new Response('sensitive', { headers: { 'retry-after': '60' }, status: 429 })),
    );

    await expect(adapter.listRepositories(context)).rejects.toMatchObject({
      message: 'GitLab API request failed with status 429.',
      retryAt: expect.any(Date),
      status: 429,
    });
  });

  it('maps projects and pipelines using only GitLab read endpoints', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(readFixture('projects.json'))))
      .mockResolvedValueOnce(new Response(JSON.stringify(readFixture('pipelines.json'))));
    const adapter = new GitLabPipelinesAdapter(fetchFn);

    await expect(adapter.listRepositories(context)).resolves.toEqual([
      {
        providerRepositoryId: '1',
        owner: 'group',
        name: 'ezrepo',
        url: 'https://gitlab.example.test/group/ezrepo',
      },
    ]);
    await expect(
      adapter.listWorkflowRuns(context, { providerRepositoryId: '1', owner: 'group', name: 'ezrepo' }),
    ).resolves.toMatchObject([
      {
        displayTitle: 'main',
        durationMs: 120_000,
        event: 'push',
        headBranch: 'main',
        headSha: '0123456789abcdef',
        providerRunId: '7',
        providerWorkflowId: 'pipeline',
        scopeKey: 'branch:main',
        status: 'SUCCESS',
        workflowName: 'Pipeline',
      },
    ]);
    expect(fetchFn).toHaveBeenCalledWith(expect.stringContaining('/api/v4/projects'), expect.anything());
  });

  it('paginates more than 100 incremental pipelines', async () => {
    const pipeline = (id: number) => ({
      created_at: '2026-09-13T10:00:00Z',
      duration: 60,
      finished_at: '2026-09-13T10:01:00Z',
      id,
      started_at: '2026-09-13T10:00:00Z',
      status: 'success',
      updated_at: '2026-09-13T10:01:00Z',
      web_url: `https://gitlab.example.test/group/ezrepo/-/pipelines/${id}`,
    });
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(Array.from({ length: 100 }, (_, index) => pipeline(index)))))
      .mockResolvedValueOnce(new Response(JSON.stringify([pipeline(100)])));

    await expect(
      new GitLabPipelinesAdapter(fetchFn).listWorkflowRuns(
        context,
        { providerRepositoryId: '1', owner: 'group', name: 'ezrepo' },
        new Date('2026-09-13T09:00:00Z'),
      ),
    ).resolves.toHaveLength(101);
    expect(fetchFn).toHaveBeenNthCalledWith(2, expect.stringContaining('page=2&per_page=100'), expect.anything());
  });

  it('loads current project metadata through the stable GitLab project ID', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 1,
          name: 'renamed',
          namespace: { full_path: 'new-group' },
          web_url: 'https://gitlab.example.test/new-group/renamed',
        }),
      ),
    );

    await expect(
      new GitLabPipelinesAdapter(fetchFn).getRepository(context, {
        providerRepositoryId: '1',
        owner: 'group',
        name: 'ezrepo',
      }),
    ).resolves.toMatchObject({ providerRepositoryId: '1', owner: 'new-group', name: 'renamed' });
    expect(fetchFn).toHaveBeenCalledWith(expect.stringContaining('/api/v4/projects/1'), expect.anything());
  });

  it('verifies current GitLab HMAC signing tokens against the raw delivery body', async () => {
    const adapter = new GitLabPipelinesAdapter();
    const payload = Buffer.from(JSON.stringify(readFixture('webhook.json')));
    const signingSecret = `whsec_${Buffer.from('signing-key').toString('base64')}`;
    const id = 'delivery-id';
    const timestamp = '1787745600';
    const signature = `v1,${createHmac('sha256', 'signing-key')
      .update(`${id}.${timestamp}.${payload.toString('utf8')}`)
      .digest('base64')}`;

    await expect(
      adapter.verifyWebhook({
        headers: {
          'webhook-id': id,
          'webhook-signature': signature,
          'webhook-timestamp': timestamp,
          'x-gitlab-event': 'Pipeline Hook',
        },
        payload,
        signingSecret,
      }),
    ).resolves.toEqual({ event: 'Pipeline Hook', providerRepositoryId: '42', syncScopes: ['WORKFLOWS'] });
  });

  it('maps manual merge-request pipelines without issuing a provider write', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            created_at: '2026-09-09T08:00:00Z',
            duration: null,
            finished_at: null,
            id: 8,
            merge_request: { iid: 12 },
            ref: 'feature/approval',
            started_at: null,
            status: 'manual',
            updated_at: '2026-09-09T08:00:00Z',
            web_url: 'https://gitlab.example.test/group/ezrepo/-/pipelines/8',
          },
        ]),
      ),
    );
    const adapter = new GitLabPipelinesAdapter(fetchFn);

    await expect(
      adapter.listWorkflowRuns(context, { providerRepositoryId: '1', owner: 'group', name: 'ezrepo' }),
    ).resolves.toMatchObject([
      {
        awaitingApproval: true,
        reviewUrl: 'https://gitlab.example.test/group/ezrepo/-/merge_requests/12',
        status: 'QUEUED',
      },
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('GitLabPipelinesAdapter change requests', () => {
  const context = { accessToken: 'token', baseUrl: 'https://gitlab.example.test', providerAccountId: 'account' };
  const repository = { name: 'ezrepo', owner: 'octo', providerRepositoryId: '1' };

  it.each([
    ['opened', null, 'OPEN'],
    ['closed', null, 'CLOSED'],
    ['merged', '2026-09-12T10:00:00.000Z', 'MERGED'],
  ] as const)('normalizes a %s merge request with merged-at %s as %s', async (state, mergedAt, expected) => {
    const adapter = new GitLabPipelinesAdapter(
      jest.fn().mockResolvedValue(new Response(JSON.stringify({ merged_at: mergedAt, state, target_branch: 'main' }))),
    );

    await expect(adapter.getChangeRequestState(context, repository, '42')).resolves.toEqual({
      mergedAt: mergedAt ? new Date(mergedAt) : null,
      state: expected,
      targetBranch: 'main',
    });
  });

  it('normalizes separate GitLab issue and merge-request fixtures', async () => {
    const adapter = new GitLabPipelinesAdapter(
      jest
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(readFixture('issues.json'))))
        .mockResolvedValueOnce(new Response(JSON.stringify(readFixture('labels.json'))))
        .mockResolvedValueOnce(new Response(JSON.stringify(readFixture('pull-requests.json'))))
        .mockResolvedValueOnce(new Response(JSON.stringify(readFixture('labels.json')))),
    );
    const query = { includeAllOpen: false, updatedAfter: new Date('2026-08-01T00:00:00Z') };
    await expect(adapter.listIssues(context, repository, query)).resolves.toMatchObject([
      { labels: [{ color: 'd73a4a', name: 'bug', providerLabelId: '1' }], number: '7', state: 'OPEN' },
    ]);
    await expect(adapter.listPullRequests(context, repository, query)).resolves.toMatchObject([
      { draft: true, number: '8', sourceBranch: 'feature/work', targetBranch: 'main' },
    ]);
  });

  it('returns null when the merge request is unavailable', async () => {
    const adapter = new GitLabPipelinesAdapter(jest.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(adapter.getChangeRequestState(context, repository, '42')).resolves.toBeNull();
  });
});
