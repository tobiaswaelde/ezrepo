import { BadRequestException, Injectable } from '@nestjs/common';
import picomatch from 'picomatch';

export type WorkflowFilterMode = 'ALLOW' | 'DENY';

/** A persisted repository workflow filter used during read-only synchronization. */
export interface WorkflowFilterRule {
  mode: WorkflowFilterMode;
  pattern: string;
}

/** Validates and evaluates repository workflow filters with deny precedence. */
@Injectable()
export class WorkflowFilterService {
  /**
   * Validate a workflow-name glob before it is stored as a repository filter.
   *
   * @param pattern - Workflow-name glob to validate.
   * @returns No return value.
   * @throws BadRequestException - Workflow filter patterns must not be empty. Workflow filter pattern is invalid.
   */
  validatePattern(pattern: string): void {
    if (pattern.trim().length === 0 || pattern.includes('\u0000')) {
      throw new BadRequestException('Workflow filter patterns must not be empty.');
    }

    try {
      picomatch(pattern, { bash: true });
    } catch {
      throw new BadRequestException('Workflow filter pattern is invalid.');
    }
  }

  /**
   * Return whether a workflow should be tracked.
   *
   * Deny rules always take precedence. With one or more allow rules, a name
   * must match at least one allow rule; without allow rules, it is included.
   *
   * @param workflowName - Provider workflow name evaluated against the configured rules.
   * @param filters - Service determining whether a workflow name should be tracked.
   * @returns Whether the workflow passes allow rules and is not excluded by a deny rule.
   */
  shouldTrack(workflowName: string, filters: WorkflowFilterRule[]): boolean {
    /**
     * Determine whether a matching workflow-name filter exists for the requested rule mode.
     *
     * @param mode - Allow or deny filter mode to match.
     * @returns Whether at least one filter of this mode matches the workflow name.
     */
    const matchingRule = (mode: WorkflowFilterMode) =>
      filters.some((filter) => filter.mode === mode && picomatch.isMatch(workflowName, filter.pattern, { bash: true }));

    if (matchingRule('DENY')) return false;

    const hasAllowRules = filters.some((filter) => filter.mode === 'ALLOW');
    return !hasAllowRules || matchingRule('ALLOW');
  }
}
