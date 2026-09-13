import type { NavigationMenuItem } from '#ui/types';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';

import { useAuthStore } from '~/store/auth';

/** Optional workflow attention counters displayed only by the sidebar. */
export interface NavigationAttentionCounts {
  awaitingApproval?: MaybeRefOrGetter<number | null>;
  needsAttention?: MaybeRefOrGetter<number | null>;
}

/** Search-friendly representation of a reachable application destination. */
export interface NavigationSearchItem {
  icon: string;
  label: string;
  to: string;
}

interface AppNavigationItem extends NavigationSearchItem {
  active: boolean;
  badge?: { color: 'error' | 'warning'; label: number; variant: 'soft' };
}

/** Retain a destination's visible label as its accessible name when the sidebar collapses to icons. */
function toMenuItem(item: AppNavigationItem): NavigationMenuItem {
  return { ...item, 'aria-label': item.label };
}

/** Provide one permission-aware route definition for the sidebar, search, and future command palette. */
export function useNavigationItems(attentionCounts: NavigationAttentionCounts = {}) {
  const { t } = useI18n();
  const route = useRoute();
  const auth = useAuthStore();

  /** Match an exact route or its nested details without also selecting sibling workflow-run routes. */
  function isActive(path: string, exact = false): boolean {
    return exact ? route.path === path : route.path === path || route.path.startsWith(`${path}/`);
  }

  const dashboard = computed<AppNavigationItem>(() => ({
    active: isActive('/', true),
    icon: 'i-lucide-layout-dashboard',
    label: t('layout.dashboard'),
    to: '/',
  }));
  const workflowRuns = computed<AppNavigationItem[]>(() => [
    {
      active: isActive('/workflow-runs', true),
      icon: 'i-lucide-list-tree',
      label: t('workflowRuns.allRuns'),
      to: '/workflow-runs',
    },
    {
      active: isActive('/workflows/awaiting-approval'),
      badge:
        toValue(attentionCounts.awaitingApproval) === null || toValue(attentionCounts.awaitingApproval) === undefined
          ? undefined
          : { color: 'warning', label: toValue(attentionCounts.awaitingApproval)!, variant: 'soft' },
      icon: 'i-lucide-shield-alert',
      label: t('awaitingApproval.title'),
      to: '/workflows/awaiting-approval',
    },
    {
      active: isActive('/workflow-runs/needs-attention'),
      badge:
        toValue(attentionCounts.needsAttention) === null || toValue(attentionCounts.needsAttention) === undefined
          ? undefined
          : { color: 'error', label: toValue(attentionCounts.needsAttention)!, variant: 'soft' },
      icon: 'i-lucide-triangle-alert',
      label: t('needsAttention.title'),
      to: '/workflow-runs/needs-attention',
    },
  ]);
  const repositories = computed<AppNavigationItem>(() => ({
    active: isActive('/repositories'),
    icon: 'i-lucide-git-fork',
    label: t('layout.repositories'),
    to: '/repositories',
  }));
  const jobs = computed<AppNavigationItem>(() => ({
    active: isActive('/jobs'),
    icon: 'i-lucide-list-checks',
    label: t('layout.jobs'),
    to: '/jobs',
  }));
  const issues = computed<AppNavigationItem>(() => ({
    active: isActive('/issues'),
    icon: 'i-tabler-circle-dot',
    label: t('layout.issues'),
    to: '/issues',
  }));
  const pullRequests = computed<AppNavigationItem>(() => ({
    active: isActive('/pull-requests'),
    icon: 'i-tabler-git-pull-request',
    label: t('layout.pullRequests'),
    to: '/pull-requests',
  }));
  const notifications = computed<AppNavigationItem>(() => ({
    active: isActive('/notifications'),
    icon: 'i-lucide-bell',
    label: t('layout.notifications'),
    to: '/notifications',
  }));
  const administration = computed<AppNavigationItem[]>(() => {
    if (auth.user?.role !== 'SYSTEM_ADMIN') return [];
    return [
      {
        active: isActive('/admin/providers'),
        icon: 'i-lucide-plug-zap',
        label: t('layout.providers'),
        to: '/admin/providers',
      },
      {
        active: isActive('/admin/users'),
        icon: 'i-lucide-users',
        label: t('layout.users'),
        to: '/admin/users',
      },
      {
        active: isActive('/admin/settings'),
        icon: 'i-lucide-settings',
        label: t('layout.settings'),
        to: '/admin/settings',
      },
    ];
  });

  const navigationItems = computed<NavigationMenuItem[]>(() => {
    const items: NavigationMenuItem[] = [
      { label: t('layout.overview'), type: 'label' },
      toMenuItem(dashboard.value),
      {
        'aria-label': t('layout.workflowRuns'),
        active: workflowRuns.value.some((item) => item.active),
        children: workflowRuns.value.map(toMenuItem),
        defaultOpen: true,
        icon: 'i-lucide-list-tree',
        label: t('layout.workflowRuns'),
        type: 'trigger',
      },
      toMenuItem(issues.value),
      toMenuItem(pullRequests.value),
      { label: t('layout.operations'), type: 'label' },
      toMenuItem(repositories.value),
      toMenuItem(jobs.value),
      toMenuItem(notifications.value),
    ];

    if (administration.value.length > 0) {
      items.push({ label: t('layout.administration'), type: 'label' }, ...administration.value.map(toMenuItem));
    }

    return items;
  });

  const navigationSearchItems = computed<NavigationSearchItem[]>(() => [
    dashboard.value,
    ...workflowRuns.value,
    issues.value,
    pullRequests.value,
    repositories.value,
    jobs.value,
    notifications.value,
    ...administration.value,
  ]);

  return { navigationItems, navigationSearchItems };
}
