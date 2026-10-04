<template>
  <UCard>
    <template #header>
      <div>
        <h2 class="font-semibold">{{ $t('repositoryDetails.syncStatus.title') }}</h2>
        <p class="text-sm text-muted">{{ $t('repositoryDetails.syncStatus.description') }}</p>
      </div>
    </template>

    <div class="grid gap-4 sm:grid-cols-3">
      <div>
        <p class="text-xs font-medium uppercase tracking-wide text-muted">
          {{ $t('repositoryDetails.syncStatus.lastSuccess') }}
        </p>
        <p class="mt-1 text-sm">{{ lastSync }}</p>
      </div>
      <div>
        <p class="text-xs font-medium uppercase tracking-wide text-muted">
          {{ $t('repositoryDetails.syncStatus.dataAge') }}
        </p>
        <p class="mt-1 text-sm">{{ dataAge }}</p>
      </div>
      <div>
        <p class="text-xs font-medium uppercase tracking-wide text-muted">
          {{ $t('repositoryDetails.syncStatus.job') }}
        </p>
        <UBadge class="mt-1" variant="subtle" :color="statusColor">{{ statusLabel }}</UBadge>
      </div>
    </div>

    <UAlert
      v-if="!repository.lastSyncAt"
      class="mt-4"
      color="warning"
      icon="i-lucide-clock-alert"
      variant="subtle"
      :title="$t('repositoryDetails.syncStatus.neverSynced')"
    />
    <UAlert
      v-else-if="stale"
      class="mt-4"
      color="warning"
      icon="i-lucide-clock-alert"
      variant="subtle"
      :title="$t('repositoryDetails.syncStatus.stale')"
      :description="$t('repositoryDetails.syncStatus.staleDescription', { interval: intervalMinutes })"
    />
    <UAlert
      v-if="repository.syncState.status === 'WARNING'"
      class="mt-4"
      color="warning"
      icon="i-lucide-triangle-alert"
      variant="subtle"
      :description="
        $t('jobs.warningKinds', {
          kinds: repository.syncState.warningKinds.map((kind) => $t(`securityAlerts.kindTitles.${kind}`)).join(', '),
        })
      "
      :title="$t('jobs.status.WARNING')"
    />
    <UAlert
      v-else-if="repository.syncState.lastError"
      class="mt-4"
      color="error"
      icon="i-lucide-circle-alert"
      variant="subtle"
      :description="$t(`jobs.errors.${syncErrorKind(repository.syncState.lastError)}`)"
      :title="$t('repositoryDetails.syncStatus.latestError')"
    />
    <p v-if="activeJob" class="mt-4 text-sm text-muted">
      {{ $t('repositoryDetails.syncStatus.activeJob', { scopes: scopeLabels }) }}
    </p>
  </UCard>
</template>

<script setup lang="ts">
import { useNow } from '@vueuse/core';
import { computed } from 'vue';

import { defineProps } from 'vue';
import { useDateTime } from '~/composables/use-date-time';
import type { RepositoryDetail } from '~/types/api/resources';
import { syncErrorKind } from '~/util/sync-error';

const props = defineProps<{ repository: RepositoryDetail }>();
const { t } = useI18n();
const { formatDateTime } = useDateTime();
const now = useNow({ interval: 60_000 });
const ageMs = computed(() =>
  props.repository.lastSyncAt ? now.value.getTime() - Date.parse(props.repository.lastSyncAt) : 0,
);
const stale = computed(
  () => Boolean(props.repository.lastSyncAt) && ageMs.value > props.repository.syncIntervalSeconds * 1_000,
);
const intervalMinutes = computed(() => Math.ceil(props.repository.syncIntervalSeconds / 60));
const activeJob = computed(() => ['PENDING', 'RUNNING'].includes(props.repository.syncState.status));
const lastSync = computed(() =>
  props.repository.lastSyncAt ? formatDateTime(props.repository.lastSyncAt) : t('repositories.neverSynced'),
);
const dataAge = computed(() => {
  if (!props.repository.lastSyncAt) return t('workflowRuns.notAvailable');
  const minutes = Math.max(0, Math.floor(ageMs.value / 60_000));
  if (minutes < 60) return t('repositoryDetails.syncStatus.ageMinutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('repositoryDetails.syncStatus.ageHours', { count: hours });
  return t('repositoryDetails.syncStatus.ageDays', { count: Math.floor(hours / 24) });
});
const statusLabel = computed(() =>
  props.repository.syncState.status === 'WARNING'
    ? t('jobs.status.WARNING')
    : t(`repositoryDetails.syncStatus.status.${props.repository.syncState.status}`),
);
const statusColor = computed(() => {
  if (props.repository.syncState.status === 'FAILED') return 'error';
  if (props.repository.syncState.status === 'WARNING') return 'warning';
  if (activeJob.value) return 'info';
  return 'neutral';
});
const scopeLabels = computed(() =>
  props.repository.syncState.scopes.map((scope) => t(`jobs.scopes.${scope}`)).join(', '),
);
</script>
