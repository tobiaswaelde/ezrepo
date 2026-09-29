import type { PrismaService } from '../../prisma/prisma.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { ProviderAdapter, ProviderSecurityAlert } from './provider-adapter.js';
import { SecurityAlertSyncService } from './security-alert-sync.service.js';

describe('SecurityAlertSyncService', () => {
  const context = { accessToken: 'token', baseUrl: null, providerAccountId: 'account' };
  const repository = { id: 'repository', name: 'ezrepo', owner: 'octo', providerRepositoryId: '1' };
  const dependencyAlert: ProviderSecurityAlert = {
    description: 'Safe description',
    ecosystem: 'npm',
    fixedVersion: null,
    identifiers: ['CVE-1'],
    kind: 'DEPENDENCY',
    location: null,
    manifest: 'package.json',
    packageName: 'vite',
    providerAlertId: '1',
    providerCreatedAt: new Date('2026-09-01T00:00:00Z'),
    providerUpdatedAt: new Date('2026-09-02T00:00:00Z'),
    providerUrl: 'https://github.test/alert/1',
    resolution: null,
    resolvedAt: null,
    ruleId: null,
    scanner: 'Dependabot',
    secretProvider: null,
    secretType: null,
    severity: 'HIGH',
    state: 'OPEN',
    title: 'Dependency issue',
    tool: null,
    vulnerableRange: '<1.0.0',
  };

  it('establishes independent silent baselines and emits later state transitions once', async () => {
    const prisma = createPrisma();
    let syncRead = 0;
    prisma.securityAlertSyncState.findUnique.mockImplementation(() => {
      syncRead += 1;
      return Promise.resolve(
        syncRead <= 3 ? null : { baselineEstablished: true, synchronizedThrough: dependencyAlert.providerUpdatedAt },
      );
    });
    prisma.securityAlert.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ state: 'OPEN' })
      .mockResolvedValueOnce({ state: 'RESOLVED' })
      .mockResolvedValueOnce({ state: 'RESOLVED' })
      .mockResolvedValueOnce({ state: 'OPEN' });
    const notifications = { emitSecurityAlertEvent: jest.fn().mockResolvedValue(undefined) };
    const adapter = createAdapter({ ...dependencyAlert });
    const service = new SecurityAlertSyncService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );

    await expect(service.synchronize(context, repository, adapter)).resolves.toEqual([]);
    expect(notifications.emitSecurityAlertEvent).not.toHaveBeenCalled();

    adapter.listSecurityAlerts = jest.fn().mockResolvedValue(
      results({
        ...dependencyAlert,
        providerUpdatedAt: new Date('2026-09-03T00:00:00Z'),
        resolution: 'fixed',
        resolvedAt: new Date('2026-09-03T00:00:00Z'),
        state: 'RESOLVED',
      }),
    );
    await expect(service.synchronize(context, repository, adapter)).resolves.toEqual([]);

    await expect(service.synchronize(context, repository, adapter)).resolves.toEqual([]);
    adapter.listSecurityAlerts = jest.fn().mockResolvedValue(
      results({
        ...dependencyAlert,
        providerUpdatedAt: new Date('2026-09-04T00:00:00Z'),
        state: 'OPEN',
      }),
    );
    await expect(service.synchronize(context, repository, adapter)).resolves.toEqual([]);
    adapter.listSecurityAlerts = jest.fn().mockResolvedValue(
      results({
        ...dependencyAlert,
        providerUpdatedAt: new Date('2026-09-05T00:00:00Z'),
        resolution: 'tolerable risk',
        resolvedAt: new Date('2026-09-05T00:00:00Z'),
        state: 'DISMISSED',
      }),
    );
    await expect(service.synchronize(context, repository, adapter)).resolves.toEqual([]);

    expect(notifications.emitSecurityAlertEvent).toHaveBeenCalledTimes(3);
    expect(notifications.emitSecurityAlertEvent).toHaveBeenNthCalledWith(
      1,
      'DEPENDENCY_ALERT_RESOLVED',
      expect.objectContaining({ state: 'RESOLVED' }),
    );
    expect(notifications.emitSecurityAlertEvent).toHaveBeenNthCalledWith(
      2,
      'DEPENDENCY_ALERT_OPENED',
      expect.objectContaining({ state: 'OPEN' }),
    );
    expect(notifications.emitSecurityAlertEvent).toHaveBeenNthCalledWith(
      3,
      'DEPENDENCY_ALERT_RESOLVED',
      expect.objectContaining({ state: 'DISMISSED' }),
    );
  });

  it('records unsupported providers without turning them into warnings', async () => {
    const prisma = createPrisma();
    const service = new SecurityAlertSyncService(
      prisma as unknown as PrismaService,
      { emitSecurityAlertEvent: jest.fn() } as unknown as NotificationsService,
    );

    await expect(service.synchronize(context, repository, {} as ProviderAdapter)).resolves.toEqual([]);
    expect(prisma.securityAlertSyncState.upsert).toHaveBeenCalledTimes(3);
    expect(prisma.securityAlertSyncState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ availability: 'UNSUPPORTED' }) }),
    );
  });
});

function results(alert: ProviderSecurityAlert) {
  return [
    { alerts: [alert], availability: 'AVAILABLE' as const, kind: 'DEPENDENCY' as const, reason: null },
    { alerts: [], availability: 'AVAILABLE' as const, kind: 'CODE' as const, reason: null },
    { alerts: [], availability: 'AVAILABLE' as const, kind: 'SECRET' as const, reason: null },
  ];
}

function createAdapter(alert: ProviderSecurityAlert): ProviderAdapter {
  return { listSecurityAlerts: jest.fn().mockResolvedValue(results(alert)) } as unknown as ProviderAdapter;
}

function createPrisma() {
  return {
    securityAlert: {
      findUnique: jest.fn(),
      upsert: jest.fn(({ create, update }) => Promise.resolve({ id: 'alert', ...create, ...update })),
    },
    securityAlertSyncState: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
    },
  };
}
