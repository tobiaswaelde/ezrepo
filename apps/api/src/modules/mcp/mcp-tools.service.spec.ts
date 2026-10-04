import type { AuthenticatedUser } from '../auth/types.js';
import type { DashboardService } from '../dashboard/dashboard.service.js';
import type { RepositoriesQueryService } from '../repositories/repositories-query.service.js';
import type { WorkflowRunsQueryService } from '../workflow-runs/workflow-runs-query.service.js';
import { McpToolsService } from './mcp-tools.service.js';

describe('McpToolsService', () => {
  it('uses the centralized actionable approval query for items and totals', async () => {
    const ability = {};
    const workflowRuns = {
      findAwaitingApproval: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'approval' }]),
      getReadAbility: jest.fn().mockResolvedValue(ability),
    };
    const service = new McpToolsService(
      {} as DashboardService,
      {} as RepositoriesQueryService,
      workflowRuns as unknown as WorkflowRunsQueryService,
    );
    const user: AuthenticatedUser = {
      authProvider: 'LOCAL',
      id: 'viewer',
      role: 'VIEWER',
      username: 'viewer',
    };

    await expect(
      service.listAwaitingApproval(user, { limit: 25, page: 2, repositoryId: 'repository' }),
    ).resolves.toEqual({
      items: [],
      page: 2,
      perPage: 25,
      total: 1,
    });
    const where = { AND: [{ repositoryId: 'repository' }, {}, {}, {}, {}] };
    expect(workflowRuns.findAwaitingApproval).toHaveBeenNthCalledWith(
      1,
      {
        include: expect.anything(),
        skip: 25,
        take: 25,
        where,
      },
      ability,
    );
    expect(workflowRuns.findAwaitingApproval).toHaveBeenNthCalledWith(2, { select: { id: true }, where }, ability);
  });
});
