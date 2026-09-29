import { ForbiddenException } from '@nestjs/common';

import { DefaultDateTimeFormat } from '../../generated/prisma/client.js';
import { SettingsController } from './settings.controller.js';
import type { SettingsService } from './settings.service.js';

describe('SettingsController', () => {
  const persisted = {
    dateTimeFormat: DefaultDateTimeFormat.ISO,
    issueRetentionDays: 30,
    pullRequestRetentionDays: 60,
    workflowRunRetentionDays: 180,
  };
  const settings = {
    get: jest.fn().mockResolvedValue(persisted),
    update: jest.fn().mockResolvedValue(persisted),
  };
  const controller = new SettingsController(settings as unknown as SettingsService);

  beforeEach(() => jest.clearAllMocks());

  it('returns settings to an authenticated client', async () => {
    await expect(controller.get()).resolves.toBe(persisted);
    expect(settings.get).toHaveBeenCalledTimes(1);
  });

  it('updates settings for a system administrator', async () => {
    await expect(
      controller.update({ user: { id: 'admin', role: 'SYSTEM_ADMIN', username: 'admin' } }, persisted),
    ).resolves.toBe(persisted);
    expect(settings.update).toHaveBeenCalledWith(persisted);
  });

  it('rejects updates from non-administrators', () => {
    expect(() => controller.update({ user: { id: 'viewer', role: 'VIEWER', username: 'viewer' } }, persisted)).toThrow(
      ForbiddenException,
    );
    expect(settings.update).not.toHaveBeenCalled();
  });
});
