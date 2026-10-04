<template>
  <UCard class="h-full">
    <template #header>
      <div>
        <h2 class="font-semibold">{{ $t('dashboard.statusDistribution') }}</h2>
        <p class="mt-1 text-xs text-muted">{{ $t('dashboard.statusDistributionDescription') }}</p>
      </div>
    </template>

    <div v-if="loading && !summary" class="flex flex-col items-center gap-6 py-5">
      <USkeleton class="size-36 rounded-full" />
      <USkeleton class="h-12 w-full" />
    </div>
    <div v-else-if="summary?.completedCount" class="space-y-5">
      <div class="relative mx-auto size-40">
        <svg class="size-full -rotate-90" viewBox="0 0 120 120" role="img" :aria-label="distributionLabel">
          <circle class="stroke-elevated" cx="60" cy="60" fill="none" pathLength="100" r="48" stroke-width="13" />
          <circle
            v-for="segment in segments"
            :key="segment.key"
            cx="60"
            cy="60"
            fill="none"
            pathLength="100"
            r="48"
            stroke-width="13"
            class="transition-[stroke-dasharray,stroke-dashoffset] duration-300"
            :class="segment.class"
            :stroke-dasharray="`${segment.percentage} ${100 - segment.percentage}`"
            :stroke-dashoffset="-segment.offset"
          >
            <title>{{ segment.label }}: {{ segment.value }}</title>
          </circle>
        </svg>
        <div class="absolute inset-0 flex flex-col items-center justify-center text-center">
          <strong class="text-2xl tabular-nums">{{ formatNumber(summary.completedCount) }}</strong>
          <span class="text-xs text-muted">{{ $t('dashboard.runsTotal') }}</span>
        </div>
      </div>

      <ul class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <li v-for="segment in segments" :key="segment.key" class="flex items-center justify-between gap-3">
          <span class="flex min-w-0 items-center gap-2 text-muted">
            <i class="size-2 shrink-0 rounded-full" :class="segment.dotClass" />
            <span class="truncate">{{ segment.label }}</span>
          </span>
          <strong class="tabular-nums">{{ formatNumber(segment.value) }}</strong>
        </li>
      </ul>
    </div>
    <p v-else class="py-16 text-center text-sm text-muted">{{ $t('dashboard.noStatusData') }}</p>
  </UCard>
</template>

<script setup lang="ts">
import { defineProps } from 'vue';
import type { DashboardSummary } from '~/types/api/resources';

const props = defineProps<{
  loading: boolean;
  summary: DashboardSummary | null;
}>();

const { locale, t } = useI18n();

const segmentDefinitions = computed(() => [
  { class: 'status-success', dotClass: 'bg-success', key: 'success', label: t('workflowStatus.SUCCESS') },
  { class: 'status-failed', dotClass: 'bg-error', key: 'failed', label: t('workflowStatus.FAILED') },
  { class: 'status-cancelled', dotClass: 'bg-warning', key: 'cancelled', label: t('workflowStatus.CANCELLED') },
  { class: 'status-skipped', dotClass: 'bg-info', key: 'skipped', label: t('workflowStatus.SKIPPED') },
  { class: 'status-unknown', dotClass: 'bg-muted', key: 'unknown', label: t('workflowStatus.UNKNOWN') },
]);

const segments = computed(() => {
  let offset = 0;
  const total = props.summary?.completedCount ?? 0;
  return segmentDefinitions.value.map((definition) => {
    const value = props.summary?.statuses[definition.key as keyof DashboardSummary['statuses']] ?? 0;
    const percentage = total === 0 ? 0 : (value / total) * 100;
    const segment = { ...definition, offset, percentage, value };
    offset += percentage;
    return segment;
  });
});

const distributionLabel = computed(() =>
  t('dashboard.statusDistributionLabel', {
    cancelled: props.summary?.statuses.cancelled ?? 0,
    failed: props.summary?.statuses.failed ?? 0,
    skipped: props.summary?.statuses.skipped ?? 0,
    success: props.summary?.statuses.success ?? 0,
    unknown: props.summary?.statuses.unknown ?? 0,
  }),
);

/** Format a status count using the active interface locale. */
function formatNumber(value: number): string {
  return new Intl.NumberFormat(locale.value).format(value);
}
</script>

<style scoped>
.status-success {
  stroke: var(--ui-success);
}

.status-failed {
  stroke: var(--ui-error);
}

.status-cancelled {
  stroke: var(--ui-warning);
}

.status-skipped {
  stroke: var(--ui-info);
}

.status-unknown {
  stroke: var(--ui-text-muted);
}
</style>
