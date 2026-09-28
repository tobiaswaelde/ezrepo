import { Controller, Get, Version, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { HealthService, type HealthResponse } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  /**
   * Initialize HealthController with its required dependencies.
   *
   * @param healthService - Service reading database and persisted provider health.
   */
  constructor(private readonly healthService: HealthService) {}

  /**
   * Return database reachability and the last persisted provider synchronization state.
   *
   * @returns Database health and safe persisted provider synchronization summaries.
   */
  @Get()
  @Version(VERSION_NEUTRAL)
  @ApiOperation({ summary: 'Get application health status' })
  @ApiOkResponse({
    description: 'The API process, database, and persisted provider synchronization state.',
    schema: {
      example: {
        api: 'ok',
        database: 'ok',
        providers: [
          {
            displayName: 'ezRepo GitHub',
            enabled: true,
            id: 'd83a37cd-e664-4dcd-a7f7-c6c61463f625',
            lastSyncAt: '2026-08-26T08:30:00.000Z',
            providerType: 'GITHUB',
            syncStatus: 'healthy',
          },
        ],
        status: 'ok',
      },
    },
  })
  async getHealth(): Promise<HealthResponse> {
    return this.healthService.getHealth();
  }
}
