import { Injectable, Logger } from '@nestjs/common';

import { ENV } from '../config/env.js';

export interface JobExecutionConfiguration {
  SCHEDULER_ENABLED: boolean;
  isTest: boolean;
}

/**
 * Determine whether background work may execute in the current process.
 *
 * @param configuration - Configuration values used to select and validate this operation.
 * @returns Whether scheduling is enabled and the process is outside the test environment.
 */
export function isJobExecutionEnabled(configuration: JobExecutionConfiguration): boolean {
  return configuration.SCHEDULER_ENABLED && !configuration.isTest;
}

/** Runs named application jobs only when the runtime configuration permits it. */
@Injectable()
export class JobRunnerService {
  private readonly logger = new Logger(JobRunnerService.name);

  /**
   * Execute a background job when scheduling is enabled outside tests.
   *
   * @param name - Stable job name used in logs.
   * @param callback - Asynchronous work to perform.
   * @returns True when the job ran, false when it was intentionally skipped.
   */
  async run(name: string, callback: () => Promise<void>): Promise<boolean> {
    if (!isJobExecutionEnabled(ENV)) {
      this.logger.debug(`Skipping ${name} because scheduling is disabled.`);
      return false;
    }

    await callback();
    return true;
  }
}
