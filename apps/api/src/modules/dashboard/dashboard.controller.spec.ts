import type { AuthenticatedUser } from '../auth/types.js';
import { DashboardController } from './dashboard.controller.js';
import type { DashboardService } from './dashboard.service.js';

describe('DashboardController', () => {
  const user: AuthenticatedUser = { authProvider: 'LOCAL' as const, id: 'viewer', role: 'VIEWER', username: 'viewer' };
  const request = { user };
  const period = { from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T23:59:59.999Z' };

  it('maps visible approval-gated runs through the public dashboard DTO', async () => {
    const dashboard = { getAwaitingApproval: jest.fn().mockResolvedValue([]) };

    await expect(
      new DashboardController(dashboard as unknown as DashboardService).getAwaitingApproval(request),
    ).resolves.toEqual([]);
    expect(dashboard.getAwaitingApproval).toHaveBeenCalledWith(user);
  });

  it('forwards summary requests with the authenticated user and requested period', async () => {
    const summary = {
      awaitingApprovalCount: 1,
      completedCount: 2,
      medianDurationMs: 120_000,
      queuedCount: 0,
      runningCount: 1,
      statuses: { cancelled: 0, failed: 1, skipped: 0, success: 1, unknown: 0 },
      successRate: 50,
      totalRunDurationMs: 240_000,
    };
    const dashboard = { getSummary: jest.fn().mockResolvedValue(summary) };

    await expect(
      new DashboardController(dashboard as unknown as DashboardService).getSummary(request, period),
    ).resolves.toBe(summary);
    expect(dashboard.getSummary).toHaveBeenCalledWith(user, period);
  });

  it('forwards repository-health requests with the authenticated user and requested period', async () => {
    const repositories = [
      {
        completedCount: 2,
        failedCount: 1,
        medianDurationMs: 120_000,
        repository: { id: 'repository', name: 'ezrepo', owner: 'ezrepo', url: 'https://example.test' },
        successRate: 50,
      },
    ];
    const dashboard = { getRepositoryHealth: jest.fn().mockResolvedValue(repositories) };

    await expect(
      new DashboardController(dashboard as unknown as DashboardService).getRepositoryHealth(request, period),
    ).resolves.toBe(repositories);
    expect(dashboard.getRepositoryHealth).toHaveBeenCalledWith(user, period);
  });
});
