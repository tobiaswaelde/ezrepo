import { AppriseNotificationAdapter } from './apprise-notification.adapter.js';

describe('AppriseNotificationAdapter', () => {
  it('does not attempt to decrypt a channel that has no replacement URL', async () => {
    const credentials = { decrypt: jest.fn() };
    const adapter = new AppriseNotificationAdapter(credentials as never);

    await expect(
      adapter.send({ encryptedUrl: null } as never, {
        eventType: 'WORKFLOW_RUN_FAILED',
        occurredAt: new Date('2026-09-14T10:00:00.000Z'),
        provider: 'GITHUB',
        repository: 'ezrepo/ezrepo',
        subject: 'CI',
        subjectUrl: 'https://example.test/run/1',
      }),
    ).rejects.toThrow('Apprise notification delivery failed.');
    expect(credentials.decrypt).not.toHaveBeenCalled();
  });
});
