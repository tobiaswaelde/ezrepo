import type { ProviderType, WorkflowRunStatus } from '../../generated/prisma/client.js';

/**
 * Identify provider states that require a human approval before execution can continue.
 *
 * @param provider - Provider identity or persisted metadata associated with the operation.
 * @param lifecycle - Raw provider lifecycle or execution state.
 * @param conclusion - Optional terminal provider conclusion, taking precedence where supported.
 * @returns Whether the provider state indicates pending human approval.
 */
export function isWorkflowRunAwaitingApproval(
  provider: ProviderType,
  lifecycle: string,
  conclusion: string | null = null,
): boolean {
  const state = lifecycle.toLowerCase();
  const outcome = conclusion?.toLowerCase();
  if (provider === 'GITLAB') return state === 'manual';
  return state === 'waiting' || outcome === 'action_required';
}

/**
 * Normalize provider lifecycle and conclusion values without discarding the raw provider value.
 *
 * @param provider - Provider identity or persisted metadata associated with the operation.
 * @param lifecycle - Raw provider lifecycle or execution state.
 * @param conclusion - Optional terminal provider conclusion, taking precedence where supported.
 * @returns The application workflow status corresponding to the provider state.
 */
export function normalizeWorkflowRunStatus(
  provider: ProviderType,
  lifecycle: string,
  conclusion: string | null = null,
): WorkflowRunStatus {
  const state = lifecycle.toLowerCase();
  if (['in_progress', 'running'].includes(state)) return 'RUNNING';
  if (
    [
      'blocked',
      'queued',
      'pending',
      'requested',
      'created',
      'waiting',
      'waiting_for_resource',
      'preparing',
      'scheduled',
    ].includes(state)
  )
    return 'QUEUED';
  const normalized: Record<string, WorkflowRunStatus> = {
    success: 'SUCCESS',
    failure: 'FAILED',
    failed: 'FAILED',
    cancelled: 'CANCELLED',
    canceled: 'CANCELLED',
    skipped: 'SKIPPED',
    action_required: 'QUEUED',
  };
  return (
    normalized[(conclusion ?? lifecycle).toLowerCase()] ??
    (provider === 'GITLAB' && state === 'manual' ? 'QUEUED' : 'UNKNOWN')
  );
}
