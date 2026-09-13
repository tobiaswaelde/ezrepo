import { ForbiddenException } from '@nestjs/common';

import { RepositorySyncJobsController } from './repository-sync-jobs.controller.js';

describe('RepositorySyncJobsController', () => {
  const jobs = {
    query: jest.fn(),
    start: jest.fn().mockResolvedValue(1),
    startAll: jest.fn().mockResolvedValue(2),
    summary: jest.fn(),
  };
  const controller = new RepositorySyncJobsController(jobs as never);

  it('allows every authenticated user to query visible jobs', async () => {
    const user = { id: 'viewer', role: 'VIEWER' as const, username: 'viewer' };
    const query = { page: 1, perPage: 10 } as never;
    jobs.query.mockResolvedValueOnce({ items: [], meta: {} });

    await controller.query({ user }, query);

    expect(jobs.query).toHaveBeenCalledWith(user, query);
  });

  it('allows only system administrators to start jobs', async () => {
    const viewer = { id: 'viewer', role: 'VIEWER' as const, username: 'viewer' };
    const admin = { id: 'admin', role: 'SYSTEM_ADMIN' as const, username: 'admin' };

    await expect(controller.runAll({ user: viewer })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.runAll({ user: admin })).resolves.toEqual({ queuedCount: 2 });
    await expect(controller.run({ user: admin }, 'repository-id')).resolves.toEqual({ queuedCount: 1 });
  });
});
