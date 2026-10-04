<template>
  <UCard>
    <template #header>
      <h2 class="font-semibold">{{ $t('dashboard.latestRuns') }}</h2>
    </template>

    <div v-if="loading && !runs.length" class="space-y-3">
      <USkeleton v-for="index in 5" :key="index" class="h-12 w-full" />
    </div>
    <div v-else-if="runs.length" class="overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-default text-muted">
          <tr>
            <th class="pb-3">{{ $t('dashboard.workflow') }}</th>
            <th class="pb-3">{{ $t('dashboard.status') }}</th>
            <th class="pb-3">{{ $t('dashboard.duration') }}</th>
            <th class="pb-3">{{ $t('workflowRuns.columns.completed') }}</th>
            <th class="pb-3 text-right">{{ $t('repositories.columns.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="run in runs" :key="run.id" class="border-b border-default last:border-0">
            <td class="py-3">
              <p class="font-medium">{{ run.displayTitle }}</p>
              <p class="text-xs text-muted">{{ run.repository.owner }}/{{ run.repository.name }}</p>
            </td>
            <td class="py-3"><EnumsWorkflowRunStatusBadge :status="run.status" /></td>
            <td class="py-3">{{ formatDuration(run.durationMs) }}</td>
            <td class="py-3 whitespace-nowrap">{{ formatTimestamp(run.completedAt) }}</td>
            <td class="py-3 text-right">
              <UTooltip :text="$t('dashboard.openProvider')">
                <UButton
                  color="neutral"
                  icon="i-tabler-external-link"
                  rel="noreferrer"
                  target="_blank"
                  variant="ghost"
                  :aria-label="$t('dashboard.openProvider')"
                  :to="run.url"
                />
              </UTooltip>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="py-12 text-center text-sm text-muted">{{ $t('dashboard.noRuns') }}</p>
  </UCard>
</template>

<script setup lang="ts">
import { defineProps } from 'vue';
import { useDateTime } from '~/composables/use-date-time';
import type { DashboardWorkflowRun } from '~/types/api/resources';

const { locale, t } = useI18n();
const { formatDateTime } = useDateTime();

defineProps<{
  loading: boolean;
  runs: DashboardWorkflowRun[];
}>();

/** Format an optional workflow duration for compact table display. */
function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return t('dashboard.durationUnknown');
  const seconds = Math.round(durationMs / 1000);
  const formatter = new Intl.NumberFormat(locale.value);
  return seconds >= 60
    ? t('dashboard.durationMinutesSeconds', {
        minutes: formatter.format(Math.floor(seconds / 60)),
        seconds: formatter.format(seconds % 60),
      })
    : t('dashboard.durationSeconds', { seconds: formatter.format(seconds) });
}

/** Format an API timestamp in the user's browser locale. */
function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return t('workflowRuns.notAvailable');
  return formatDateTime(timestamp);
}
</script>
