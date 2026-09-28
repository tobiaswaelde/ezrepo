import { Injectable } from '@nestjs/common';

import type { ProviderType } from '../../generated/prisma/client.js';
import type { ProviderAdapter } from './provider-adapter.js';

/** Resolves the installed read-only adapter for a provider type. */
@Injectable()
export class ProviderAdapterRegistry {
  /**
   * Initialize ProviderAdapterRegistry with its required dependencies.
   *
   * @param adapters - Installed read-only provider adapter implementations.
   */
  constructor(private readonly adapters: ProviderAdapter[]) {}
  /**
   * Resolve the registered read-only adapter for a provider type.
   *
   * @param providerType - Provider implementation selected for the operation.
   * @returns The adapter registered for the provider.
   * @throws Error - When no adapter is registered for the requested provider type.
   */
  get(providerType: ProviderType): ProviderAdapter {
    const adapter = this.adapters.find((candidate) => candidate.providerType === providerType);
    if (!adapter) throw new Error(`No adapter is installed for ${providerType}.`);
    return adapter;
  }
}
