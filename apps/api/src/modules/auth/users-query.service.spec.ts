import { ForbiddenException } from '@nestjs/common';

import { UsersQueryService } from './users-query.service.js';

describe('UsersQueryService', () => {
  const ability = {};
  const abilityFactory = { createForUser: jest.fn(() => ability) };
  const prisma = { user: {} };
  const service = new UsersQueryService(prisma as never, abilityFactory as never);

  beforeEach(() => jest.clearAllMocks());

  it('gives system administrators an unrestricted user ability', () => {
    expect(
      service.getReadAbility({ authProvider: 'LOCAL' as const, id: 'admin', role: 'SYSTEM_ADMIN', username: 'admin' }),
    ).toBe(ability);
    expect(abilityFactory.createForUser).toHaveBeenCalledWith(
      { authProvider: 'LOCAL' as const, id: 'admin', role: 'SYSTEM_ADMIN', username: 'admin' },
      [],
    );
  });

  it('rejects non-administrators before building a user query', () => {
    expect(() =>
      service.getReadAbility({ authProvider: 'LOCAL' as const, id: 'manager', role: 'MANAGER', username: 'manager' }),
    ).toThrow(ForbiddenException);
  });

  it('uses a stable username order when the table has no selected sort', () => {
    expect(service.toQueryOptions({ page: 1, perPage: 10 })).toMatchObject({
      orderBy: [{ username: 'asc' }, { id: 'asc' }],
      page: 1,
      perPage: 10,
    });
  });
});
