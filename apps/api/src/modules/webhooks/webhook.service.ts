import { Injectable, UnauthorizedException } from '@nestjs/common';

import type { ProviderType } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProviderAdapterRegistry } from '../providers/provider-adapter.registry.js';
import { ProviderCredentialService } from '../providers/provider-credential.service.js';
import { ProviderSyncQueueService } from '../providers/sync-queue.service.js';

/** Raw signed webhook data supplied by the HTTP controller. */
export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  payload: Uint8Array;
}

/** Result returned after a provider webhook is verified and recorded. */
export interface WebhookAcceptance {
  accepted: true;
  duplicate: boolean;
}

/** Verifies signed provider webhooks and schedules read-only targeted synchronization. */
@Injectable()
export class WebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: ProviderAdapterRegistry,
    private readonly credentials: ProviderCredentialService,
    private readonly syncQueue: ProviderSyncQueueService,
  ) {}

  /**
   * Verify and record one webhook delivery before scheduling its repository synchronization.
   *
   * @param providerType - Provider that owns the endpoint.
   * @param providerAccountId - Configured ezRepo provider account identifier.
   * @param request - Raw request data required for signature validation.
   * @returns Accepted delivery metadata, including duplicate delivery detection.
   * @throws {UnauthorizedException} When the account or signature cannot be verified.
   */
  async receive(
    providerType: ProviderType,
    providerAccountId: string,
    request: WebhookRequest,
  ): Promise<WebhookAcceptance> {
    const account = await this.prisma.providerAccount.findUnique({
      where: { id: providerAccountId },
      select: {
        enabled: true,
        encryptedWebhookSecret: true,
        providerType: true,
      },
    });
    if (!account || !account.enabled || account.providerType !== providerType || !account.encryptedWebhookSecret) {
      throw new UnauthorizedException('Webhook signature validation failed.');
    }

    const verified = await this.adapters.get(providerType).verifyWebhook({
      headers: request.headers,
      payload: request.payload,
      signingSecret: this.credentials.decrypt(account.encryptedWebhookSecret),
    });
    const deliveryId = this.getDeliveryId(providerType, request.headers);
    if (!verified || !deliveryId) throw new UnauthorizedException('Webhook signature validation failed.');

    try {
      await this.prisma.transaction(async (transaction) => {
        await transaction.webhookDelivery.create({
          data: {
            deliveryId,
            event: verified.event,
            providerAccountId,
            providerRepositoryId: verified.providerRepositoryId,
          },
        });
        if (verified.providerRepositoryId)
          if (verified.syncScopes)
            await this.syncQueue.enqueueWebhookRepository(
              providerAccountId,
              verified.providerRepositoryId,
              transaction,
              verified.syncScopes,
            );
          else
            await this.syncQueue.enqueueWebhookRepository(
              providerAccountId,
              verified.providerRepositoryId,
              transaction,
            );
      });
    } catch (error) {
      if (this.isDuplicateDeliveryError(error)) return { accepted: true, duplicate: true };
      throw error;
    }
    return { accepted: true, duplicate: false };
  }

  private getDeliveryId(
    providerType: ProviderType,
    headers: Record<string, string | string[] | undefined>,
  ): string | null {
    const candidates =
      providerType === 'GITHUB'
        ? [headers['x-github-delivery']]
        : providerType === 'GITLAB'
          ? [headers['webhook-id'], headers['x-gitlab-event-uuid']]
          : providerType === 'FORGEJO'
            ? [headers['x-forgejo-delivery'], headers['x-gitea-delivery']]
            : [headers['x-gitea-delivery']];
    return candidates.find((header): header is string => typeof header === 'string' && header.length > 0) ?? null;
  }

  private isDuplicateDeliveryError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
