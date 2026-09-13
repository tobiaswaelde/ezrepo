import { BadRequestException, type INestApplication, VERSION_NEUTRAL, VersioningType } from '@nestjs/common';
import { VERSION_METADATA } from '@nestjs/common/constants.js';
import { Test } from '@nestjs/testing';

import { WebhookController } from './webhook.controller.js';
import { WebhookService } from './webhook.service.js';

describe('WebhookController', () => {
  it('passes the unmodified raw body to the provider-specific service', async () => {
    const service = {
      receive: jest.fn().mockResolvedValue({ accepted: true, duplicate: false }),
    } as unknown as WebhookService;
    const controller = new WebhookController(service);
    const request = {
      headers: { 'x-github-delivery': 'delivery-id' },
      rawBody: Buffer.from('{"repository":{"id":42}}'),
    };

    await expect(controller.github('repository-id', request as never)).resolves.toEqual({
      accepted: true,
      duplicate: false,
    });
    expect(service.receive).toHaveBeenCalledWith('GITHUB', 'repository-id', {
      headers: request.headers,
      payload: request.rawBody,
    });
  });

  it('rejects a request when the raw signed body is unavailable', () => {
    const controller = new WebhookController({} as WebhookService);

    expect(() => controller.gitlab('account-id', { headers: {} } as never)).toThrow(BadRequestException);
  });

  it('passes a Gitea delivery to the dedicated provider endpoint', async () => {
    const service = {
      receive: jest.fn().mockResolvedValue({ accepted: true, duplicate: false }),
    } as unknown as WebhookService;
    const controller = new WebhookController(service);
    const request = {
      headers: { 'x-gitea-delivery': 'delivery-id' },
      rawBody: Buffer.from('{"repository":{"id":42}}'),
    };

    await controller.gitea('repository-id', request as never);

    expect(service.receive).toHaveBeenCalledWith('GITEA', 'repository-id', {
      headers: request.headers,
      payload: request.rawBody,
    });
  });

  it.each(['github', 'gitlab', 'forgejo', 'gitea'] as const)(
    'exposes the %s endpoint through versioned and stable unversioned routes',
    (method) => {
      expect(Reflect.getMetadata(VERSION_METADATA, WebhookController.prototype[method])).toEqual([
        '1',
        VERSION_NEUTRAL,
      ]);
    },
  );

  it('accepts deliveries through both the stable and versioned webhook URLs', async () => {
    const service = {
      receive: jest.fn().mockResolvedValue({ accepted: true, duplicate: false }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [{ provide: WebhookService, useValue: service }],
    }).compile();
    const app: INestApplication = moduleRef.createNestApplication({ rawBody: true });
    app.enableVersioning({ defaultVersion: '1', type: VersioningType.URI });
    app.setGlobalPrefix('api');

    await app.listen(0, '127.0.0.1');
    try {
      const baseUrl = await app.getUrl();
      for (const path of ['/api/webhooks/github/repository-id', '/api/v1/webhooks/github/repository-id']) {
        const response = await fetch(`${baseUrl}${path}`, {
          body: '{"repository":{"id":42}}',
          headers: { 'content-type': 'application/json', 'x-github-delivery': 'delivery-id' },
          method: 'POST',
        });
        expect(response.status).toBe(202);
      }
    } finally {
      await app.close();
    }

    expect(service.receive).toHaveBeenCalledTimes(2);
  });
});
