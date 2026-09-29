import { ForbiddenException } from '@nestjs/common';

import { CaslAbilityFactory } from '../../casl/casl-ability.factory.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TestDatabaseService } from '../../prisma/test-database.service.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { SecurityAlertsQueryService } from './security-alerts-query.service.js';
import { SecurityAlertsController } from './security-alerts.controller.js';

describe('security-alert authorization integration', () => {
  const prisma = new PrismaService();
  const database = new TestDatabaseService(prisma);
  const alerts = new SecurityAlertsQueryService(prisma, new CaslAbilityFactory());
  const controller = new SecurityAlertsController(prisma, alerts);
  let users: Record<'admin' | 'manager' | 'viewer', AuthenticatedUser>;
  let visibleAlertId: string;

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
          url: 'https://github.test/ezrepo/visible',
        },
      }),
      prisma.repository.create({
        data: {
          name: 'hidden',
          owner: 'ezrepo',
          providerAccountId: account.id,
          providerRepositoryId: 'hidden',
          url: 'https://github.test/ezrepo/hidden',
        },
      }),
    ]);
    const [admin, manager, viewer] = await Promise.all([
      prisma.user.create({ data: { passwordHash: 'hash', role: 'SYSTEM_ADMIN', username: 'admin' } }),
      prisma.user.create({ data: { passwordHash: 'hash', role: 'MANAGER', username: 'manager' } }),
      prisma.user.create({ data: { passwordHash: 'hash', role: 'VIEWER', username: 'viewer' } }),
    ]);
    await Promise.all([
      prisma.repositoryMembership.create({
        data: { repositoryId: visibleRepository.id, role: 'MANAGER', userId: manager.id },
      }),
      prisma.repositoryMembership.create({
        data: { repositoryId: visibleRepository.id, role: 'VIEWER', userId: viewer.id },
      }),
      prisma.securityAlertSyncState.create({
        data: { availability: 'UNAVAILABLE', kind: 'SECRET', repositoryId: visibleRepository.id },
      }),
    ]);
    const now = new Date('2026-09-29T00:00:00Z');
    const createAlert = (repositoryId: string, providerAlertId: string, title: string) =>
      prisma.securityAlert.create({
        data: {
          identifiers: [],
          kind: 'DEPENDENCY',
          providerAlertId,
          providerCreatedAt: now,
          providerUpdatedAt: now,
          providerUrl: `https://github.test/alert/${providerAlertId}`,
          repositoryId,
          severity: 'HIGH',
          state: 'OPEN',
          title,
        },
      });
    const [visibleAlert] = await Promise.all([
      createAlert(visibleRepository.id, 'visible', 'Visible alert'),
      createAlert(hiddenRepository.id, 'hidden', 'Hidden alert'),
    ]);
    users = {
      admin: { id: admin.id, role: admin.role, username: admin.username },
      manager: { id: manager.id, role: manager.role, username: manager.username },
      viewer: { id: viewer.id, role: viewer.role, username: viewer.username },
    };
    visibleAlertId = visibleAlert.id;
  });
  afterAll(async () => prisma.onModuleDestroy());

  it.each([
    ['admin', 2],
    ['manager', 1],
  ] as const)('%s sees only permitted alerts', async (role, count) => {
    const ability = await alerts.getReadAbility(users[role]);
    await expect(alerts.findMany({}, ability)).resolves.toHaveLength(count);
  });

  it('blocks viewers even when they have repository membership', async () => {
    await expect(alerts.getReadAbility(users.viewer)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns permission-scoped summaries, filters, and safe details', async () => {
    await expect(controller.summary({ user: users.manager })).resolves.toMatchObject({
      open: { CODE: 0, DEPENDENCY: 1, SECRET: 0 },
      unavailableRepositories: 1,
    });
    await expect(controller.filterOptions({ user: users.manager })).resolves.toMatchObject({
      repositories: [{ name: 'visible', owner: 'ezrepo' }],
    });
    await expect(controller.findById({ user: users.manager }, visibleAlertId)).resolves.toMatchObject({
      description: null,
      title: 'Visible alert',
    });
  });
});
