import type { Filtering } from '@querry-kit/nuxt-ui/types';

/** Dashboard presets supported by issue and pull-request tables. */
export type WorkItemDashboardPresetName = 'approval-required' | 'open' | 'stale';

/** Dashboard presets supported by the workflow-run table. */
export type WorkflowRunDashboardPresetName = 'active';

/** Resolved table state for one recognized dashboard deep link. */
export interface DashboardTablePreset<TName extends string> {
  filtering: Filtering;
  name: TName;
  staticFilter?: Record<string, unknown>;
}

const emptyFiltering = (): Filtering => ({ filters: [], operator: 'AND' });

const openStateFilter = () => ({
  field: 'state',
  id: 'dashboard-state',
  operator: 'in' as const,
  type: 'enum' as const,
  value: ['OPEN'],
});

/** Resolve a supported dashboard preset for an issue or pull-request table. */
export function resolveWorkItemDashboardPreset(
  kind: 'issue' | 'pull-request',
  value: unknown,
  now = new Date(),
): DashboardTablePreset<WorkItemDashboardPresetName> | undefined {
  if (value === 'open') {
    return { filtering: { filters: [openStateFilter()], operator: 'AND' }, name: value };
  }

  if (kind === 'issue' && value === 'stale') {
    return {
      filtering: { filters: [openStateFilter()], operator: 'AND' },
      name: value,
      staticFilter: { providerUpdatedAt: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000).toISOString() } },
    };
  }

  if (kind === 'pull-request' && value === 'approval-required') {
    return {
      filtering: {
        filters: [
          openStateFilter(),
          {
            field: 'workflowApprovalRequired',
            id: 'dashboard-workflow-approval-required',
            type: 'boolean',
            value: true,
          },
        ],
        operator: 'AND',
      },
      name: value,
    };
  }

  return undefined;
}

/** Resolve a supported dashboard preset for the workflow-run table. */
export function resolveWorkflowRunDashboardPreset(
  value: unknown,
): DashboardTablePreset<WorkflowRunDashboardPresetName> | undefined {
  if (value !== 'active') return undefined;
  return {
    filtering: {
      filters: [
        {
          field: 'status',
          id: 'dashboard-status',
          operator: 'in',
          type: 'enum',
          value: ['QUEUED', 'RUNNING'],
        },
      ],
      operator: 'AND',
    },
    name: value,
  };
}

/** Return an empty user-controlled filter state after a dashboard preset is cleared. */
export function emptyDashboardFiltering(): Filtering {
  return emptyFiltering();
}
