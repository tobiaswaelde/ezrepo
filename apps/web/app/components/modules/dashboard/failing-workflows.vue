<template>
  <UCard class="h-full">
    <template #header>
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold">{{ $t('dashboard.needsAttention') }}</h2>
          <p class="mt-1 text-xs text-muted">{{ $t('dashboard.needsAttentionDescription') }}</p>
        </div>
        <UButton
          color="neutral"
          icon="i-lucide-arrow-right"
          size="sm"
          to="/workflow-runs/needs-attention"
          variant="ghost"
          :label="$t('dashboard.viewNeedsAttention')"
        />
      </div>
    </template>

    <div v-if="loading && !runs.length" class="space-y-3">
      <USkeleton v-for="index in 3" :key="index" class="h-16 w-full" />
    </div>
    <div v-else-if="runs.length" class="divide-y divide-default">
      <div v-for="run in runs" :key="run.id" class="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
        <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-error/10 text-error">
          <UIcon class="size-4" name="i-lucide-triangle-alert" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate font-medium">{{ run.displayTitle }}</p>
          <p class="truncate text-xs text-muted">
            {{ run.repository.owner }}/{{ run.repository.name }} · {{ formatTimestamp(run.completedAt) }}
          </p>
        </div>
        <EnumsProviderTypeBadge
          class="hidden sm:inline-flex"
          size="xs"
          variant="subtle"
          :value="run.provider.providerType"
        />
        <UButton
          color="neutral"
          icon="i-tabler-external-link"
          rel="noreferrer"
          target="_blank"
          variant="ghost"
          :aria-label="$t('dashboard.openProvider')"
          :to="run.url"
        />
      </div>
    </div>
    <div v-else class="flex flex-col items-center py-10 text-center">
      <span class="mb-3 flex size-10 items-center justify-center rounded-full bg-success/10 text-success">
        <UIcon class="size-5" name="i-lucide-circle-check-big" />
      </span>
      <p class="text-sm font-medium">{{ $t('dashboard.noFailures') }}</p>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import { defineProps } from 'vue';
import { useDateTime } from '~/composables/use-date-time';
import type { DashboardWorkflowRun } from '~/types/api/resources';

defineProps<{
  loading: boolean;
  runs: DashboardWorkflowRun[];
}>();

const { t } = useI18n();
const { formatDateTime } = useDateTime();

/** Format the last failed completion time in the active interface locale. */
function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return t('workflowRuns.notAvailable');
  return formatDateTime(timestamp);
}
</script>
