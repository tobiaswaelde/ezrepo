import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { CaslAbilityFactory } from './casl-ability.factory.js';
import type { PolicyHandler } from './check-policies.decorator.js';
import { PoliciesGuard } from './policies.guard.js';

describe('PoliciesGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
  const prisma = {
    repositoryMembership: { findMany: jest.fn() },
  };
  const abilityFactory = { createForUser: jest.fn() } as unknown as CaslAbilityFactory;
  const guard = new PoliciesGuard(reflector, prisma as never, abilityFactory);
  const context = (user?: { authProvider: 'LOCAL'; id: string; role: 'VIEWER'; username: string }) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows protected endpoints without a resource policy after JWT authentication', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);

    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(prisma.repositoryMembership.findMany).not.toHaveBeenCalled();
  });

  it('loads memberships and allows requests accepted by every policy', async () => {
    const policy: PolicyHandler = jest.fn().mockReturnValue(true);
    const ability = {};
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([policy]);
    prisma.repositoryMembership.findMany.mockResolvedValue([{ repositoryId: 'repo-1', role: 'VIEWER' }]);
    (abilityFactory.createForUser as jest.Mock).mockReturnValue(ability);

    await expect(
      guard.canActivate(context({ authProvider: 'LOCAL' as const, id: 'user-1', role: 'VIEWER', username: 'viewer' })),
    ).resolves.toBe(true);
    expect(prisma.repositoryMembership.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: { repositoryId: true, role: true },
    });
    expect(policy).toHaveBeenCalledWith(ability);
  });

  it('denies a request when any policy rejects the resolved ability', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([() => false]);
    prisma.repositoryMembership.findMany.mockResolvedValue([]);
    (abilityFactory.createForUser as jest.Mock).mockReturnValue({});

    await expect(
      guard.canActivate(context({ authProvider: 'LOCAL' as const, id: 'user-1', role: 'VIEWER', username: 'viewer' })),
    ).resolves.toBe(false);
  });
});
