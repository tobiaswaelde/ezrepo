<template>
  <UCard class="h-full">
    <template #header>
      <div>
        <h2 class="font-semibold">{{ $t('dashboard.repositoryHealth') }}</h2>
        <p class="mt-1 text-xs text-muted">{{ $t('dashboard.repositoryHealthDescription') }}</p>
      </div>
    </template>

    <div v-if="loading && !repositories.length" class="space-y-5 py-2">
      <USkeleton v-for="index in 4" :key="index" class="h-12 w-full" />
    </div>
    <div v-else-if="repositories.length" class="space-y-5">
      <div v-for="repository in repositories" :key="repository.repository.id" class="space-y-2">
        <div class="flex items-start justify-between gap-3 text-sm">
          <div class="min-w-0">
            <p class="truncate font-medium">{{ repository.repository.owner }}/{{ repository.repository.name }}</p>
            <p class="text-xs text-muted">
              {{
                $t('dashboard.repositoryHealthContext', {
                  duration: formatDuration(repository.medianDurationMs),
                  failures: formatNumber(repository.failedCount),
                  runs: formatNumber(repository.completedCount),
                })
              }}
            </p>
          </div>
          <strong class="shrink-0 tabular-nums">{{ formatNumber(repository.successRate, 1) }} %</strong>
        </div>
        <div
          class="h-2 overflow-hidden rounded-full bg-elevated"
          role="progressbar"
          aria-valuemax="100"
          aria-valuemin="0"
          :aria-label="
            $t('dashboard.repositorySuccessRate', {
              repository: `${repository.repository.owner}/${repository.repository.name}`,
            })
          "
          :aria-valuenow="repository.successRate"
        >
          <div
            class="h-full rounded-full transition-[width] duration-300"
            :class="progressColor(repository.successRate)"
            :style="{ width: `${repository.successRate}%` }"
          />
        </div>
      </div>
    </div>
    <p v-else class="py-16 text-center text-sm text-muted">{{ $t('dashboard.noRepositoryHealth') }}</p>
  </UCard>
</template>

<script setup lang="ts">
import { defineProps } from 'vue';
import type { RepositoryHealth } from '~/types/api/resources';

defineProps<{
  loading: boolean;
  repositories: RepositoryHealth[];
}>();

const { locale, t } = useI18n();

/** Format one repository metric using the active interface locale. */
function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(locale.value, { maximumFractionDigits }).format(value);
}

/** Format a median repository duration for compact supporting text. */
function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return t('dashboard.durationUnknown');
  const seconds = Math.round(durationMs / 1_000);
  return t('dashboard.durationMinutesSeconds', {
    minutes: formatNumber(Math.floor(seconds / 60)),
    seconds: formatNumber(seconds % 60),
  });
}

/** Select a semantic progress color for one repository success rate. */
function progressColor(successRate: number): string {
  if (successRate < 80) return 'bg-error';
  if (successRate < 95) return 'bg-warning';
  return 'bg-success';
}
</script>
