import { ForbiddenException } from '@nestjs/common';

import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CredentialEncryptionService } from '../../security/credential-encryption.service.js';
import { BrowserPushService } from './browser-push.service.js';

describe('BrowserPushService', () => {
  function createService(existingUserId?: string) {
    const prisma = {
      browserPushSubscription: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(existingUserId ? { userId: existingUserId } : null),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
    };
    const credentials = { encrypt: jest.fn((value: string) => `encrypted:${value}`) };
    return {
      credentials,
      prisma,
      service: new BrowserPushService(
        prisma as unknown as PrismaService,
        credentials as unknown as CredentialEncryptionService,
      ),
    };
  }

  it('encrypts browser endpoint and key material before persistence', async () => {
    const { credentials, prisma, service } = createService();
    await service.register('user-a', {
      endpoint: 'https://push.example.com/subscription',
      keys: { auth: 'auth-secret', p256dh: 'public-key' },
    });

    expect(credentials.encrypt).toHaveBeenCalledTimes(3);
    expect(prisma.browserPushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          encryptedAuth: 'encrypted:auth-secret',
          encryptedEndpoint: 'encrypted:https://push.example.com/subscription',
          encryptedP256dh: 'encrypted:public-key',
          userId: 'user-a',
        }),
      }),
    );
  });

  it('does not transfer an existing endpoint between users', async () => {
    const { service } = createService('user-b');
    await expect(
      service.register('user-a', {
        endpoint: 'https://push.example.com/subscription',
        keys: { auth: 'auth-secret', p256dh: 'public-key' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
