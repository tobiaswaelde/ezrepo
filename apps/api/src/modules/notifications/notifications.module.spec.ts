import { Test } from '@nestjs/testing';

import { PrismaModule } from '../../prisma/prisma.module.js';
import { NotificationsModule } from './notifications.module.js';
import { NotificationsService } from './notifications.service.js';

describe('NotificationsModule', () => {
  it('resolves notification services', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PrismaModule, NotificationsModule] }).compile();

    expect(moduleRef.get(NotificationsService)).toBeInstanceOf(NotificationsService);

    await moduleRef.close();
  });
});
