import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type { ProviderType } from '../../../generated/prisma/client.js';

/** Safe repository webhook configuration metadata that never contains the signing secret. */
export class RepositoryWebhookConfigurationDto {
  @ApiProperty({ format: 'uuid' })
  repositoryId!: string;

  @ApiProperty({ enum: ['GITHUB', 'GITLAB', 'FORGEJO', 'GITEA'] })
  providerType!: ProviderType;

  @ApiProperty({ format: 'uri' })
  callbackUrl!: string;

  @ApiProperty()
  configured!: boolean;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  lastDeliveryAt!: Date | null;
}
