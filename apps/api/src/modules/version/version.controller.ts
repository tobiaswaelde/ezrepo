import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Authenticated } from '../auth/authenticated.decorator.js';
import { VersionService } from './version.service.js';

/** Exposes read-only release metadata to authenticated ezRepo users. */
@ApiTags('version')
@Authenticated()
@Controller('version')
export class VersionController {
  /**
   * Initialize VersionController with its required dependencies.
   *
   * @param version - Service reading and caching the latest published release.
   */
  constructor(private readonly version: VersionService) {}

  /**
   * Return the latest released ezRepo SemVer version when GitHub is reachable.
   *
   * @returns The latest published version, or null when a valid version is unavailable.
   */
  @Get('latest')
  @ApiOperation({ summary: 'Get the latest released ezRepo version' })
  @ApiOkResponse({ schema: { example: { latest: '0.1.2' } } })
  getLatest(): Promise<{ latest: string | null }> {
    return this.version.getLatest();
  }
}
