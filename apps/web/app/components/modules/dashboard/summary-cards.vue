<template>
  <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-6" :aria-label="$t('dashboard.summary')">
    <component
      :is="metric.to ? NuxtLink : 'div'"
      v-for="metric in metrics"
      :key="metric.key"
      class="block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      :class="metric.to ? 'group' : undefined"
      :to="metric.to"
    >
      <UCard
        class="h-full transition-colors"
        :class="[
          metric.highlighted ? 'border-warning/60 bg-warning/5' : undefined,
          metric.to ? 'group-hover:border-primary/60 group-hover:bg-elevated' : undefined,
        ]"
        :ui="{ body: 'space-y-3' }"
      >
        <div class="flex items-center justify-between gap-3">
          <p class="text-xs font-medium uppercase tracking-wide text-muted">{{ metric.label }}</p>
          <UIcon class="size-4 text-muted" :name="metric.icon" />
        </div>
        <USkeleton v-if="loading && !summary" class="h-8 w-24" />
        <p v-else class="text-2xl font-semibold tabular-nums">{{ metric.value }}</p>
        <p class="text-xs text-muted">{{ metric.context }}</p>
      </UCard>
    </component>
  </section>
</template>

<script setup lang="ts">
import type { DashboardSummary } from '~/types/api/resources';

const props = defineProps<{
  failingWorkflowCount: number;
  loading: boolean;
  summary: DashboardSummary | null;
}>();

const NuxtLink = resolveComponent('NuxtLink');
const { locale, t } = useI18n();

interface SummaryMetric {
  context: string;
  highlighted?: boolean;
  icon: string;
  key: string;
  label: string;
  to?: string;
  value: string;
}

const metrics = computed<SummaryMetric[]>(() => {
  const summary = props.summary;
  const activeCount = (summary?.queuedCount ?? 0) + (summary?.runningCount ?? 0);
  return [
    {
      context: t('dashboard.completedRuns', { count: formatNumber(summary?.completedCount ?? 0) }),
      icon: 'i-lucide-circle-check-big',
      key: 'success-rate',
      label: t('dashboard.successRate'),
      to: '/workflow-runs',
      value: summary ? `${formatNumber(summary.successRate, 1)} %` : '—',
    },
    {
      context: t('dashboard.failedRuns', { count: formatNumber(summary?.statuses.failed ?? 0) }),
      icon: 'i-lucide-circle-alert',
      key: 'failing-workflows',
      label: t('dashboard.failingNow'),
      to: '/workflow-runs/needs-attention',
      value: formatNumber(props.failingWorkflowCount),
    },
    {
      context: t('dashboard.awaitingApprovalContext'),
      highlighted: true,
      icon: 'i-lucide-shield-alert',
      key: 'awaiting-approval',
      label: t('dashboard.awaitingApproval'),
      to: '/workflows/awaiting-approval',
      value: summary ? formatNumber(summary.awaitingApprovalCount) : '—',
    },
    {
      context: t('dashboard.completedDurationContext'),
      icon: 'i-lucide-timer',
      key: 'median-duration',
      label: t('dashboard.medianDuration'),
      to: '/workflow-runs',
      value: summary ? formatDuration(summary.medianDurationMs) : '—',
    },
    {
      context: t('dashboard.totalDurationContext'),
      icon: 'i-lucide-timer-reset',
      key: 'total-duration',
      label: t('dashboard.totalDuration'),
      to: '/workflow-runs',
      value: summary ? formatTotalDuration(summary.totalRunDurationMs) : '—',
    },
    {
      context: t('dashboard.activeRunsContext', {
        queued: formatNumber(summary?.queuedCount ?? 0),
        running: formatNumber(summary?.runningCount ?? 0),
      }),
      icon: 'i-lucide-activity',
      key: 'active-runs',
      label: t('dashboard.activeRuns'),
      to: '/workflow-runs?preset=active',
      value: summary ? formatNumber(activeCount) : '—',
    },
  ];
});

/** Format one dashboard number using the active interface locale. */
function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(locale.value, { maximumFractionDigits }).format(value);
}

/** Format a median duration as a compact minutes-and-seconds value. */
function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return t('dashboard.durationUnknown');
  const seconds = Math.round(durationMs / 1_000);
  return t('dashboard.durationMinutesSeconds', {
    minutes: formatNumber(Math.floor(seconds / 60)),
    seconds: formatNumber(seconds % 60),
  });
}

/** Format the all-time duration as compact minutes. */
function formatTotalDuration(durationMs: number): string {
  const minutes = Math.round(durationMs / 60_000);
  const compactMinutes =
    minutes >= 1_000_000
      ? `${formatNumber(minutes / 1_000_000, 3)}M`
      : minutes >= 1_000
        ? `${formatNumber(minutes / 1_000, 3)}K`
        : formatNumber(minutes);
  return t('dashboard.durationMinutesCompact', { minutes: compactMinutes });
}
</script>
