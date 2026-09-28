import { ApiProperty } from '@nestjs/swagger';

import type { ProviderRepository } from '../provider-adapter.js';

/** A provider repository that can be added to ezRepo tracking. */
export class ProviderRepositoryDto {
  @ApiProperty()
  providerRepositoryId!: string;
  @ApiProperty()
  owner!: string;
  @ApiProperty()
  name!: string;
  @ApiProperty({ format: 'uri' })
  url!: string;
  @ApiProperty({ description: 'Whether this provider repository is already tracked by ezRepo.' })
  tracked!: boolean;

  /**
   * Map a provider response and local tracking state to a safe API response.
   *
   * @param repository - Repository identity and metadata required by the operation.
   * @param tracked - Whether the provider repository is already tracked locally.
   * @returns The provider repository DTO with its local tracking state.
   */
  static fromProvider(repository: ProviderRepository, tracked: boolean): ProviderRepositoryDto {
    return { ...repository, tracked };
  }
}
