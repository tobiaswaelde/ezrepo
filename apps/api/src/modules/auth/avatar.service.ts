import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { IncomingMessage } from 'node:http';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';

import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import sharp from 'sharp';

import { PrismaService } from '../../prisma/prisma.service.js';

const avatarDimension = 256;
const maximumInputBytes = 2 * 1024 * 1024;
const maximumInputPixels = 16_777_216;
const maximumRedirects = 3;
const remoteTimeoutMs = 10_000;
const supportedFormats = new Map([
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
]);

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6');
}

export interface AvatarSource {
  data: Buffer;
  mimeType: string;
}

/** Validates, normalizes, stores, and retrieves user avatar images. */
@Injectable()
export class AvatarService {
  /**
   * Initialize AvatarService with its required dependencies.
   *
   * @param prisma - Database client used for persisted application state.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate and persist one user's avatar as a normalized WebP image.
   *
   * @param userId - Local user identifier targeted by the operation.
   * @param source - Image bytes and declared MIME type to validate.
   * @returns The timestamp of the persisted avatar revision.
   * @throws BadRequestException - When validation or image decoding, resizing, or WebP encoding fails.
   * @throws PayloadTooLargeException - When the supplied image exceeds 2 MB.
   */
  async save(userId: string, source: AvatarSource): Promise<Date> {
    const normalized = await this.normalize(source);
    const etag = createHash('sha256').update(normalized).digest('hex');
    const avatar = await this.prisma.userAvatar.upsert({
      where: { userId },
      create: { data: new Uint8Array(normalized), etag, userId },
      update: { data: new Uint8Array(normalized), etag },
    });
    return avatar.updatedAt;
  }

  /**
   * Remove the current user's stored avatar when present.
   *
   * @param userId - Local user identifier targeted by the operation.
   * @returns A promise that resolves when the operation completes.
   */
  async remove(userId: string): Promise<void> {
    await this.prisma.userAvatar.deleteMany({ where: { userId } });
  }

  /**
   * Load normalized avatar bytes without exposing other user data.
   *
   * @param userId - Local user identifier targeted by the operation.
   * @returns The stored WebP bytes and content hash.
   * @throws NotFoundException - Avatar not found.
   */
  async get(userId: string): Promise<{ data: Uint8Array; etag: string }> {
    const avatar = await this.prisma.userAvatar.findUnique({ where: { userId }, select: { data: true, etag: true } });
    if (!avatar) throw new NotFoundException('Avatar not found.');
    return avatar;
  }

  /**
   * Download and validate a remote HTTPS image without persisting it.
   *
   * @param sourceUrl - Remote HTTPS image URL supplied by the user.
   * @returns Validated image bytes and their supported MIME type.
   * @throws BadGatewayException - When the remote image cannot be downloaded or the response fails validation at the
   * HTTP layer.
   * @throws BadRequestException - When the URL, redirect chain, resolved address, or image content violates import
   * restrictions.
   * @throws PayloadTooLargeException - When the remote image exceeds 2 MB.
   */
  async download(sourceUrl: string): Promise<AvatarSource> {
    try {
      return await this.downloadRedirect(new URL(sourceUrl), 0);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadGatewayException('The avatar URL could not be downloaded.');
    }
  }

  /**
   * Validate and convert an avatar to a square, orientation-corrected WebP image.
   *
   * @param source - Image bytes and declared MIME type to validate.
   * @returns Normalized 256-by-256 WebP image bytes.
   * @throws BadRequestException - When validation or image decoding, resizing, or WebP encoding fails.
   * @throws PayloadTooLargeException - When the supplied image exceeds 2 MB.
   */
  private async normalize(source: AvatarSource): Promise<Buffer> {
    await this.assertValidSource(source);
    try {
      return await sharp(source.data, { animated: false, failOn: 'error', limitInputPixels: maximumInputPixels })
        .rotate()
        .resize(avatarDimension, avatarDimension, { fit: 'cover', position: 'centre' })
        .webp({ effort: 4, quality: 82 })
        .toBuffer();
    } catch {
      throw new BadRequestException('The avatar image could not be processed.');
    }
  }

  /**
   * Verify avatar byte limits, declared MIME type, decoded format, and pixel limits.
   *
   * @param source - Image bytes and declared MIME type to validate.
   * @returns A promise that resolves when the operation completes.
   * @throws BadRequestException - When bytes are empty, corrupt, exceed supported dimensions, or disagree with the
   * declared supported image format.
   * @throws PayloadTooLargeException - When the supplied image exceeds 2 MB.
   */
  private async assertValidSource(source: AvatarSource): Promise<void> {
    if (source.data.length === 0) throw new BadRequestException('The avatar image is empty.');
    if (source.data.length > maximumInputBytes)
      throw new PayloadTooLargeException('Avatar images may not exceed 2 MB.');
    if (![...supportedFormats.values()].includes(source.mimeType)) {
      throw new BadRequestException('Only JPEG, PNG, and WebP avatar images are supported.');
    }

    try {
      const metadata = await sharp(source.data, {
        animated: false,
        failOn: 'error',
        limitInputPixels: maximumInputPixels,
      }).metadata();
      const detectedMimeType = metadata.format ? supportedFormats.get(metadata.format) : undefined;
      if (!detectedMimeType || detectedMimeType !== source.mimeType) {
        throw new BadRequestException('The avatar content does not match its declared image type.');
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('The avatar image is invalid or exceeds the supported dimensions.');
    }
  }

  /**
   * Request one HTTPS avatar URL using a validated public address and bounded redirects.
   *
   * @param url - URL to validate or resolve for the current request.
   * @param redirectCount - Number of redirects already followed for this download.
   * @returns Validated image bytes and MIME type after any permitted redirects.
   * @throws BadGatewayException - The avatar URL timed out.
   * @throws BadRequestException - Avatar URLs must use HTTPS on port 443 and may not contain credentials. The avatar
   * URL redirected too many times.
   */
  private async downloadRedirect(url: URL, redirectCount: number): Promise<AvatarSource> {
    this.assertValidDownloadUrl(url, redirectCount);
    const address = await this.resolvePublicAddress(url.hostname);
    return new Promise<AvatarSource>((resolve, reject) => {
      const remoteRequest = request(
        {
          hostname: address.address,
          path: `${url.pathname}${url.search}`,
          protocol: 'https:',
          servername: url.hostname,
          headers: {
            Accept: 'image/jpeg, image/png, image/webp',
            Host: url.host,
            'User-Agent': 'ezRepo-avatar-import/1.0',
          },
        },
        (response) => {
          void this.handleDownloadResponse(response, url, redirectCount).then(resolve, reject);
        },
      );
      remoteRequest.setTimeout(remoteTimeoutMs, () => {
        remoteRequest.destroy(new BadGatewayException('The avatar URL timed out.'));
      });
      remoteRequest.on('error', reject);
      remoteRequest.end();
    });
  }

  /**
   * Enforce HTTPS, credential restrictions, the default port, and the redirect limit.
   *
   * @param url - URL to validate or resolve for the current request.
   * @param redirectCount - Number of redirects already followed for this download.
   * @returns No return value.
   * @throws BadRequestException - Avatar URLs must use HTTPS on port 443 and may not contain credentials. The avatar
   * URL redirected too many times.
   */
  private assertValidDownloadUrl(url: URL, redirectCount: number): void {
    if (url.protocol !== 'https:' || url.port || url.username || url.password) {
      throw new BadRequestException('Avatar URLs must use HTTPS on port 443 and may not contain credentials.');
    }
    if (redirectCount > maximumRedirects) throw new BadRequestException('The avatar URL redirected too many times.');
  }

  /**
   * Follow validated redirects or validate image response headers before reading the body.
   *
   * @param response - HTTP response being validated, decoded, or written.
   * @param url - URL to validate or resolve for the current request.
   * @param redirectCount - Number of redirects already followed for this download.
   * @returns Validated image bytes and MIME type from the final successful response.
   * @throws BadGatewayException - When the redirect URL is invalid or the remote server returns a non-success status.
   * @throws PayloadTooLargeException - When the declared response length exceeds 2 MB.
   * @throws BadRequestException - When the declared MIME type is unsupported.
   */
  private async handleDownloadResponse(
    response: IncomingMessage,
    url: URL,
    redirectCount: number,
  ): Promise<AvatarSource> {
    const statusCode = response.statusCode ?? 0;
    const location = response.headers.location;
    if (statusCode >= 300 && statusCode < 400 && location) {
      response.resume();
      let redirectUrl: URL;
      try {
        redirectUrl = new URL(location, url);
      } catch {
        throw new BadGatewayException('The avatar URL returned an invalid redirect.');
      }
      return this.downloadRedirect(redirectUrl, redirectCount + 1);
    }
    if (statusCode < 200 || statusCode >= 300) {
      response.resume();
      throw new BadGatewayException(`The avatar URL returned HTTP ${statusCode}.`);
    }

    const declaredLength = Number(response.headers['content-length'] ?? 0);
    if (declaredLength > maximumInputBytes) {
      response.destroy();
      throw new PayloadTooLargeException('Avatar images may not exceed 2 MB.');
    }

    const mimeType = String(response.headers['content-type'] ?? '')
      .split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (![...supportedFormats.values()].includes(mimeType)) {
      response.destroy();
      throw new BadRequestException('Only JPEG, PNG, and WebP avatar images are supported.');
    }

    return this.readDownloadBody(response, mimeType);
  }

  /**
   * Collect an avatar response within the byte limit and validate its decoded image content.
   *
   * @param response - HTTP response being validated, decoded, or written.
   * @param mimeType - Normalized supported image MIME type from the response headers.
   * @returns Validated image bytes and the declared supported MIME type.
   * @throws PayloadTooLargeException - When streamed response bytes exceed 2 MB.
   * @throws BadRequestException - When the completed image fails format or dimension validation.
   */
  private readDownloadBody(response: IncomingMessage, mimeType: string): Promise<AvatarSource> {
    return new Promise<AvatarSource>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      response.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes > maximumInputBytes) {
          response.destroy(new PayloadTooLargeException('Avatar images may not exceed 2 MB.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const source = { data: Buffer.concat(chunks), mimeType };
        void this.assertValidSource(source).then(() => resolve(source), reject);
      });
      response.on('error', reject);
    });
  }

  /**
   * Resolve a hostname and reject it if any returned address is outside the permitted public ranges.
   *
   * @param hostname - Hostname or IP literal to resolve and validate.
   * @returns The first resolved public address and its IP family.
   * @throws BadRequestException - The avatar URL must resolve only to public internet addresses.
   */
  private async resolvePublicAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
    const normalizedHostname = hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(normalizedHostname)
      ? [{ address: normalizedHostname, family: isIP(normalizedHostname) as 4 | 6 }]
      : await lookup(normalizedHostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address, family }) => this.isBlockedAddress(address, family))) {
      throw new BadRequestException('The avatar URL must resolve only to public internet addresses.');
    }
    return addresses[0] as { address: string; family: 4 | 6 };
  }

  /**
   * Check IPv4, IPv6, and mapped IPv4 addresses against the avatar import blocklist.
   *
   * @param address - IP address to check against the blocked network ranges.
   * @param family - IP address family, using 4 for IPv4 and 6 for IPv6.
   * @returns Whether the address belongs to a blocked or unsupported mapped range.
   */
  private isBlockedAddress(address: string, family: number): boolean {
    if (family === 6 && address.toLowerCase().startsWith('::ffff:')) {
      const mappedAddress = address.slice(address.lastIndexOf(':') + 1);
      return isIP(mappedAddress) !== 4 || blockedAddresses.check(mappedAddress, 'ipv4');
    }
    return blockedAddresses.check(address, family === 6 ? 'ipv6' : 'ipv4');
  }
}
