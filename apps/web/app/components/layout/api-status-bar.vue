<template>
  <footer
    class="flex min-h-8 shrink-0 items-center gap-3 border-t border-default bg-default px-3 py-1 text-xs text-muted"
    aria-live="polite"
    :aria-label="t('systemStatus.label')"
  >
    <span class="flex shrink-0 items-center gap-1.5">
      <span class="size-2 rounded-full" aria-hidden="true" :class="connectionIndicatorClass" />
      <span class="hidden sm:inline">{{ connectionLabel }}</span>
    </span>

    <span class="h-3 border-l border-default" aria-hidden="true" />

    <NuxtLink
      to="/jobs"
      class="flex shrink-0 items-center gap-1.5 rounded-sm text-default hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
      :aria-label="t('systemStatus.openJobs', { count: snapshot.runningWorkflowCount })"
    >
      <UIcon class="size-3.5" name="i-tabler-player-play" aria-hidden="true" />
      {{ t('systemStatus.runningWorkflows', { count: snapshot.runningWorkflowCount }) }}
    </NuxtLink>

    <span class="ml-auto flex min-w-0 items-center gap-2">
      <UIcon
        v-if="snapshot.activity"
        class="size-3.5 shrink-0 animate-spin text-primary"
        name="i-tabler-loader-2"
        aria-hidden="true"
      />
      <span class="truncate text-default">{{ activityLabel }}</span>
      <UProgress
        v-if="progress && progress.total > 0"
        class="hidden w-20 shrink-0 sm:block"
        color="primary"
        size="xs"
        :max="progress.total"
        :model-value="progress.current"
      />
      <span v-if="progress && progress.total > 0" class="shrink-0 tabular-nums">
        {{ t('systemStatus.progress', { current: progress.current, total: progress.total }) }}
      </span>
    </span>
  </footer>
</template>

<script setup lang="ts">
import { useSystemStatus } from '~/composables/api/system-status';

const { t } = useI18n();
const { connection, progress, snapshot } = useSystemStatus();

const connectionIndicatorClass = computed(() => ({
  'bg-success': connection.value === 'CONNECTED',
  'bg-warning': connection.value === 'CONNECTING',
  'bg-error': connection.value === 'DISCONNECTED',
}));
const connectionLabel = computed(() => t(`systemStatus.connection.${connection.value}`));
const activityLabel = computed(() =>
  snapshot.value.activity
    ? t(`systemStatus.activity.${snapshot.value.activity.phase}`)
    : t('systemStatus.activity.IDLE'),
);
</script>
