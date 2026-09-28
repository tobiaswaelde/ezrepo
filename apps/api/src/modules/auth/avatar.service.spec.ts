import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';

import { BadGatewayException, BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import sharp from 'sharp';

import { AvatarService } from './avatar.service.js';

describe('AvatarService', () => {
  const updatedAt = new Date('2026-09-12T10:00:00.000Z');
  const prisma = {
    userAvatar: {
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn().mockResolvedValue({ updatedAt }),
    },
  };
  const service = new AvatarService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('normalizes uploaded images to a metadata-free 256 pixel WebP', async () => {
    const source = await sharp({
      create: { background: '#79c1b6', channels: 3, height: 200, width: 400 },
    })
      .png()
      .withMetadata({ exif: { IFD0: { Copyright: 'must be removed' } } })
      .toBuffer();

    await expect(service.save('user-id', { data: source, mimeType: 'image/png' })).resolves.toBe(updatedAt);

    const create = prisma.userAvatar.upsert.mock.calls[0]?.[0].create as { data: Uint8Array; etag: string };
    const metadata = await sharp(create.data).metadata();
    expect(metadata).toMatchObject({ format: 'webp', height: 256, width: 256 });
    expect(metadata.exif).toBeUndefined();
    expect(create.etag).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects files over two megabytes before decoding', async () => {
    await expect(
      service.save('user-id', { data: Buffer.alloc(2 * 1024 * 1024 + 1), mimeType: 'image/png' }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('rejects a declared image type that does not match the encoded data', async () => {
    const source = await sharp({ create: { background: 'white', channels: 3, height: 10, width: 10 } })
      .png()
      .toBuffer();
    await expect(service.save('user-id', { data: source, mimeType: 'image/jpeg' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('blocks insecure and private remote avatar targets', async () => {
    await expect(service.download('http://example.com/avatar.png')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.download('https://example.com:8443/avatar.png')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.download('https://127.0.0.1/avatar.png')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.download('https://[::1]/avatar.png')).rejects.toBeInstanceOf(BadRequestException);
  });

  function remoteResponse(chunks: Buffer[], headers: IncomingMessage['headers'], statusCode = 200): IncomingMessage {
    return Object.assign(Readable.from(chunks), { headers, statusCode }) as unknown as IncomingMessage;
  }

  it('reads a streamed remote image and validates the declared format', async () => {
    const data = await sharp({ create: { background: 'white', channels: 3, height: 10, width: 10 } })
      .png()
      .toBuffer();
    const response = remoteResponse([data.subarray(0, 20), data.subarray(20)], {
      'content-type': 'IMAGE/PNG; charset=binary',
    });

    await expect(
      service['handleDownloadResponse'](response, new URL('https://example.test/avatar.png'), 0),
    ).resolves.toEqual({ data, mimeType: 'image/png' });

    await expect(
      service['handleDownloadResponse'](
        remoteResponse([data], { 'content-type': 'image/jpeg' }),
        new URL('https://example.test/avatar.png'),
        0,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['declared', 'streamed'])('enforces the %s remote image size limit', async (lengthSource) => {
    const response = remoteResponse(
      lengthSource === 'streamed' ? [Buffer.alloc(2 * 1024 * 1024), Buffer.from([1])] : [],
      {
        'content-type': 'image/png',
        ...(lengthSource === 'declared' ? { 'content-length': String(2 * 1024 * 1024 + 1) } : {}),
      },
    );

    await expect(
      service['handleDownloadResponse'](response, new URL('https://example.test/avatar.png'), 0),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(response.destroyed).toBe(true);
  });

  it('revalidates redirect destinations and enforces the redirect limit', async () => {
    const url = new URL('https://example.test/avatar.png');
    await expect(
      service['handleDownloadResponse'](remoteResponse([], { location: 'https://127.0.0.1/avatar.png' }, 302), url, 0),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service['handleDownloadResponse'](remoteResponse([], { location: '/next.png' }, 302), url, 3),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service['handleDownloadResponse'](remoteResponse([], { location: 'https://[invalid' }, 302), url, 0),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('rejects unsuccessful remote responses before decoding their body', async () => {
    await expect(
      service['handleDownloadResponse'](remoteResponse([], {}, 503), new URL('https://example.test/avatar.png'), 0),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('removes and retrieves stored avatar records without loading a user', async () => {
    prisma.userAvatar.findUnique.mockResolvedValue({ data: new Uint8Array([1, 2, 3]), etag: 'etag' });
    await expect(service.get('user-id')).resolves.toEqual({ data: new Uint8Array([1, 2, 3]), etag: 'etag' });
    await service.remove('user-id');
    expect(prisma.userAvatar.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-id' } });
  });
});
