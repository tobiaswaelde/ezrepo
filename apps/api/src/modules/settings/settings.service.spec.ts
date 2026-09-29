import { DefaultDateTimeFormat } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from './settings.service.js';

describe('SettingsService', () => {
  const applicationSettings = {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  };
  const service = new SettingsService({ applicationSettings } as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('returns global defaults before settings have been persisted', async () => {
    applicationSettings.findUnique.mockResolvedValue(null);

    await expect(service.get()).resolves.toEqual({
      dateTimeFormat: DefaultDateTimeFormat.LOCALE_MEDIUM,
      issueRetentionDays: 90,
      pullRequestRetentionDays: 90,
      workflowRunRetentionDays: 90,
    });
    expect(applicationSettings.findUnique).toHaveBeenCalledWith({ where: { key: 'global' } });
  });

  it('returns only public persisted settings', async () => {
    applicationSettings.findUnique.mockResolvedValue({
      dateTimeFormat: DefaultDateTimeFormat.ISO,
      id: 'settings',
      issueRetentionDays: 45,
      key: 'global',
      pullRequestRetentionDays: 60,
      workflowRunRetentionDays: 180,
    });

    await expect(service.get()).resolves.toEqual({
      dateTimeFormat: DefaultDateTimeFormat.ISO,
      issueRetentionDays: 45,
      pullRequestRetentionDays: 60,
      workflowRunRetentionDays: 180,
    });
  });

  it('upserts the singleton global settings record', async () => {
    const input = {
      dateTimeFormat: DefaultDateTimeFormat.LOCALE_SHORT,
      issueRetentionDays: 30,
      pullRequestRetentionDays: 60,
      workflowRunRetentionDays: 90,
    };
    applicationSettings.upsert.mockResolvedValue({ ...input, id: 'settings', key: 'global' });

    await expect(service.update(input)).resolves.toEqual(input);
    expect(applicationSettings.upsert).toHaveBeenCalledWith({
      create: { key: 'global', ...input },
      update: input,
      where: { key: 'global' },
    });
  });
});
