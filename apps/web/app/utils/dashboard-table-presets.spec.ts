import { describe, expect, it } from 'vitest';

import {
  emptyDashboardFiltering,
  resolveWorkflowRunDashboardPreset,
  resolveWorkItemDashboardPreset,
} from './dashboard-table-presets';

describe('dashboard table presets', () => {
  it('resolves open work items and rejects presets unsupported by the current kind', () => {
    expect(resolveWorkItemDashboardPreset('issue', 'open')?.filtering.filters).toEqual([
      { field: 'state', id: 'dashboard-state', operator: 'in', type: 'enum', value: ['OPEN'] },
    ]);
    expect(resolveWorkItemDashboardPreset('issue', 'approval-required')).toBeUndefined();
    expect(resolveWorkItemDashboardPreset('pull-request', 'stale')).toBeUndefined();
    expect(resolveWorkItemDashboardPreset('issue', 'unknown')).toBeUndefined();
  });

  it('uses the exact rolling 30-day boundary for stale open issues', () => {
    const preset = resolveWorkItemDashboardPreset('issue', 'stale', new Date('2026-09-14T12:30:00.000Z'));

    expect(preset).toEqual({
      filtering: {
        filters: [{ field: 'state', id: 'dashboard-state', operator: 'in', type: 'enum', value: ['OPEN'] }],
        operator: 'AND',
      },
      name: 'stale',
      staticFilter: { providerUpdatedAt: { lt: '2026-08-15T12:30:00.000Z' } },
    });
  });

  it('combines open state with workflow approval and resolves active workflow statuses', () => {
    expect(resolveWorkItemDashboardPreset('pull-request', 'approval-required')?.filtering.filters).toEqual([
      { field: 'state', id: 'dashboard-state', operator: 'in', type: 'enum', value: ['OPEN'] },
      {
        field: 'workflowApprovalRequired',
        id: 'dashboard-workflow-approval-required',
        type: 'boolean',
        value: true,
      },
    ]);
    expect(resolveWorkflowRunDashboardPreset('active')?.filtering.filters[0]).toMatchObject({
      field: 'status',
      operator: 'in',
      value: ['QUEUED', 'RUNNING'],
    });
    expect(resolveWorkflowRunDashboardPreset('failed')).toBeUndefined();
    expect(emptyDashboardFiltering()).toEqual({ filters: [], operator: 'AND' });
  });
});
