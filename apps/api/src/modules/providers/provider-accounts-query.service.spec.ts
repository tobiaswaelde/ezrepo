import { ForbiddenException } from '@nestjs/common';

import { ProviderAccountsQueryService } from './provider-accounts-query.service.js';

describe('ProviderAccountsQueryService', () => {
  const ability = {};
  const abilityFactory = { createForUser: jest.fn(() => ability) };
  const prisma = { providerAccount: {} };
  const service = new ProviderAccountsQueryService(prisma as never, abilityFactory as never);

  beforeEach(() => jest.clearAllMocks());

  it('gives system administrators an unrestricted provider-account ability', () => {
    expect(
      service.getReadAbility({ authProvider: 'LOCAL' as const, id: 'admin', role: 'SYSTEM_ADMIN', username: 'admin' }),
    ).toBe(ability);
    expect(abilityFactory.createForUser).toHaveBeenCalledWith(
      { authProvider: 'LOCAL' as const, id: 'admin', role: 'SYSTEM_ADMIN', username: 'admin' },
      [],
    );
  });

  it('rejects non-administrators before building a provider-account query', () => {
    expect(() =>
      service.getReadAbility({ authProvider: 'LOCAL' as const, id: 'viewer', role: 'VIEWER', username: 'viewer' }),
    ).toThrow(ForbiddenException);
    expect(abilityFactory.createForUser).not.toHaveBeenCalled();
  });

  it('uses a stable display-name order when the table has no selected sort', () => {
    expect(service.toQueryOptions({ page: 1, perPage: 10 })).toMatchObject({
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      page: 1,
      perPage: 10,
    });
  });

  it('searches provider identity fields while preserving caller filters', () => {
    expect(service.toQueryOptions({ page: 1, perPage: 10, search: 'github', where: { enabled: true } })).toMatchObject({
      where: {
        AND: [
          { enabled: true },
          {
            OR: [
              { displayName: { contains: 'github', mode: 'insensitive' } },
              { baseUrl: { contains: 'github', mode: 'insensitive' } },
            ],
          },
        ],
      },
    });
  });
});
