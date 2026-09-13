import { CaslAbilityFactory } from '../../casl/casl-ability.factory.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TestDatabaseService } from '../../prisma/test-database.service.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { IssuesQueryService } from '../issues/issues-query.service.js';
import { IssuesController } from '../issues/issues.controller.js';
import { PullRequestsQueryService } from '../pull-requests/pull-requests-query.service.js';
import { PullRequestsController } from '../pull-requests/pull-requests.controller.js';

/** Verify work-item access, aggregates, label filtering, metadata isolation, and repository cascades in PostgreSQL. */
describe('work-item authorization integration', () => {
  const prisma = new PrismaService();
  const database = new TestDatabaseService(prisma);
  const abilities = new CaslAbilityFactory();
  const issues = new IssuesQueryService(prisma, abilities);
  const pullRequests = new PullRequestsQueryService(prisma, abilities);
  const issueController = new IssuesController(prisma, issues);
  const pullRequestController = new PullRequestsController(prisma, pullRequests);

  let users: Record<'admin' | 'manager' | 'outsider' | 'viewer', AuthenticatedUser>;
  let visibleRepositoryId: string;
  let visibleIssueId: string;
  let hiddenIssueId: string;

  beforeAll(async () => prisma.onModuleInit());
  beforeEach(async () => {
    await database.cleanup();
    const account = await prisma.providerAccount.create({
      data: { displayName: 'GitHub', encryptedAccessToken: 'encrypted-token', providerType: 'GITHUB' },
    });
    const [visibleRepository, hiddenRepository] = await Promise.all([
      prisma.repository.create({
        data: {
          name: 'visible',
          owner: 'ezrepo',
          providerAccountId: account.id,
          providerRepositoryId: 'visible',
          url: 'https://github.com/ezrepo/visible',
        },
      }),
      prisma.repository.create({
        data: {
          name: 'hidden',
          owner: 'ezrepo',
          providerAccountId: account.id,
          providerRepositoryId: 'hidden',
          url: 'https://github.com/ezrepo/hidden',
        },
      }),
    ]);
    const [admin, manager, viewer, outsider] = await Promise.all([
      prisma.user.create({ data: { passwordHash: 'hash', role: 'SYSTEM_ADMIN', username: 'admin' } }),
      prisma.user.create({ data: { passwordHash: 'hash', role: 'MANAGER', username: 'manager' } }),
      prisma.user.create({ data: { passwordHash: 'hash', role: 'VIEWER', username: 'viewer' } }),
      prisma.user.create({ data: { passwordHash: 'hash', role: 'VIEWER', username: 'outsider' } }),
    ]);
    await Promise.all([
      prisma.repositoryMembership.create({
        data: { repositoryId: visibleRepository.id, role: 'MANAGER', userId: manager.id },
      }),
      prisma.repositoryMembership.create({
        data: { repositoryId: visibleRepository.id, role: 'VIEWER', userId: viewer.id },
      }),
    ]);
    users = {
      admin: { id: admin.id, role: admin.role, username: admin.username },
      manager: { id: manager.id, role: manager.role, username: manager.username },
      outsider: { id: outsider.id, role: outsider.role, username: outsider.username },
      viewer: { id: viewer.id, role: viewer.role, username: viewer.username },
    };
    const [visibleAuthor, hiddenAuthor] = await Promise.all([
      prisma.providerActor.create({
        data: { providerAccountId: account.id, providerActorId: 'visible-author', username: 'visible-author' },
      }),
      prisma.providerActor.create({
        data: { providerAccountId: account.id, providerActorId: 'hidden-author', username: 'hidden-author' },
      }),
    ]);
    const [bug, urgent, secret] = await Promise.all([
      prisma.workItemLabel.create({
        data: { name: 'Bug', normalizedName: 'bug', repositoryId: visibleRepository.id },
      }),
      prisma.workItemLabel.create({
        data: { name: 'Urgent', normalizedName: 'urgent', repositoryId: visibleRepository.id },
      }),
      prisma.workItemLabel.create({
        data: { name: 'Secret', normalizedName: 'secret', repositoryId: hiddenRepository.id },
      }),
    ]);
    const now = new Date();
    const [visibleIssue, hiddenIssue] = await Promise.all([
      prisma.issue.create({
        data: {
          authorId: visibleAuthor.id,
          body: 'visible body',
          labels: { create: [{ labelId: bug.id }, { labelId: urgent.id }] },
          milestone: 'Visible milestone',
          number: '204',
          providerCreatedAt: now,
          providerIssueId: 'visible-issue',
          providerUpdatedAt: now,
          repositoryId: visibleRepository.id,
          state: 'OPEN',
          title: 'Visible issue',
          url: 'https://github.com/ezrepo/visible/issues/204',
        },
      }),
      prisma.issue.create({
        data: {
          authorId: hiddenAuthor.id,
          labels: { create: [{ labelId: secret.id }] },
          milestone: 'Hidden milestone',
          number: '1',
          providerCreatedAt: now,
          providerIssueId: 'hidden-issue',
          providerUpdatedAt: now,
          repositoryId: hiddenRepository.id,
          state: 'OPEN',
          title: 'Hidden issue',
          url: 'https://github.com/ezrepo/hidden/issues/1',
        },
      }),
    ]);
    await Promise.all([
      prisma.pullRequest.create({
        data: {
          authorId: visibleAuthor.id,
          number: '213',
          providerCreatedAt: now,
          providerPullRequestId: 'visible-pr',
          providerUpdatedAt: now,
          repositoryId: visibleRepository.id,
          sourceBranch: 'feature',
          state: 'OPEN',
          targetBranch: 'main',
          title: 'Visible pull request',
          url: 'https://github.com/ezrepo/visible/pull/213',
          workflowApprovalRequired: true,
          workflowStatus: 'FAILED',
        },
      }),
      prisma.pullRequest.create({
        data: {
          authorId: hiddenAuthor.id,
          number: '2',
          providerCreatedAt: now,
          providerPullRequestId: 'hidden-pr',
          providerUpdatedAt: now,
          repositoryId: hiddenRepository.id,
          sourceBranch: 'secret',
          state: 'OPEN',
          targetBranch: 'main',
          title: 'Hidden pull request',
          url: 'https://github.com/ezrepo/hidden/pull/2',
        },
      }),
    ]);
    visibleRepositoryId = visibleRepository.id;
    visibleIssueId = visibleIssue.id;
    hiddenIssueId = hiddenIssue.id;
  });
  afterAll(async () => prisma.onModuleDestroy());

  it.each([
    ['admin', 2],
    ['manager', 1],
    ['viewer', 1],
    ['outsider', 0],
  ] as const)('%s sees only repository-scoped issue and pull-request records', async (role, count) => {
    const issueAbility = await issues.getReadAbility(users[role]);
    const pullRequestAbility = await pullRequests.getReadAbility(users[role]);
    await expect(issues.findMany({}, issueAbility)).resolves.toHaveLength(count);
    await expect(pullRequests.findMany({}, pullRequestAbility)).resolves.toHaveLength(count);
  });

  it('applies label AND semantics and excludes hidden filter metadata and summaries', async () => {
    const ability = await issues.getReadAbility(users.viewer);
    await expect(
      issues.findMany(issues.toQueryOptions({ labels: ['BUG', 'urgent'] } as never), ability),
    ).resolves.toEqual([expect.objectContaining({ id: visibleIssueId })]);
    await expect(
      issues.findMany(issues.toQueryOptions({ labels: ['bug', 'missing'] } as never), ability),
    ).resolves.toEqual([]);
    await expect(issueController.summary({ user: users.viewer })).resolves.toMatchObject({ open: 1 });
    await expect(issueController.filterOptions({ user: users.viewer })).resolves.toEqual({
      assignees: [],
      authors: ['visible-author'],
      labels: ['Bug', 'Urgent'],
      milestones: ['Visible milestone'],
    });
    await expect(pullRequestController.summary({ user: users.viewer })).resolves.toEqual({
      drafts: 0,
      failedWorkflows: 1,
      open: 1,
      workflowApprovalRequired: 1,
    });
  });

  it('protects details and cascades repository-owned work-item data', async () => {
    await expect(issueController.findById({ user: users.viewer }, visibleIssueId)).resolves.toMatchObject({
      body: 'visible body',
      id: visibleIssueId,
    });
    await expect(issueController.findById({ user: users.viewer }, hiddenIssueId)).rejects.toThrow();
    await prisma.repository.delete({ where: { id: visibleRepositoryId } });
    await expect(prisma.issue.count()).resolves.toBe(1);
    await expect(prisma.pullRequest.count()).resolves.toBe(1);
    await expect(prisma.workItemLabel.count()).resolves.toBe(1);
  });
});
