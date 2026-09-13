import { toProviderIssue, toProviderPullRequest } from './work-items.js';

const base = {
  assignees: [{ id: 2, login: 'reviewer' }],
  body: 'Provider **Markdown**',
  closed_at: null,
  created_at: '2026-09-01T10:00:00Z',
  html_url: 'https://forge.example.test/owner/repo/issues/7',
  id: 70,
  labels: [{ color: 'ff0000', id: 3, name: 'bug' }],
  number: 7,
  state: 'open',
  title: 'Tracked work',
  updated_at: '2026-09-02T10:00:00Z',
  user: { id: 1, login: 'author' },
};

describe('Gitea-compatible work-item normalization', () => {
  it('retains issue actors, labels, milestone, and timestamps', () => {
    expect(toProviderIssue({ ...base, milestone: { title: 'v1' } })).toMatchObject({
      assignees: [{ providerActorId: '2', username: 'reviewer' }],
      author: { providerActorId: '1', username: 'author' },
      body: 'Provider **Markdown**',
      labels: [{ color: 'ff0000', name: 'bug', providerLabelId: '3' }],
      milestone: 'v1',
      number: '7',
      providerIssueId: '70',
      state: 'OPEN',
    });
  });

  it('keeps pull-request lifecycle and branches separate from workflow state', () => {
    expect(
      toProviderPullRequest({
        ...base,
        base: { ref: 'main' },
        draft: true,
        head: { ref: 'feature/work' },
        html_url: 'https://forge.example.test/owner/repo/pulls/7',
        merged: false,
      }),
    ).toMatchObject({
      draft: true,
      providerPullRequestId: '70',
      sourceBranch: 'feature/work',
      state: 'OPEN',
      targetBranch: 'main',
    });
  });
});
