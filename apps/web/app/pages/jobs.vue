<template>
  <LayoutPage
    :breadcrumbs="[
      { icon: 'i-lucide-layout-dashboard', label: $t('layout.dashboard'), to: '/' },
      { icon: 'i-lucide-list-checks', label: $t('jobs.title') },
    ]"
    :padded="false"
    :title="$t('jobs.title')"
  >
    <div class="space-y-4 border-b border-default p-4 sm:p-6">
      <UAlert
        v-if="loadError"
        color="error"
        icon="i-lucide-circle-alert"
        variant="subtle"
        :title="$t('jobs.loadError')"
      />

      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <div class="flex flex-col md:flex-row">
          <div class="min-w-0 flex-1 space-y-5 p-5 sm:p-7">
            <div class="flex items-start gap-3">
              <UIcon class="mt-0.5 size-6 shrink-0 text-primary" name="i-lucide-refresh-cw" aria-hidden="true" />
              <div class="min-w-0">
                <h2 class="text-lg font-semibold">{{ $t('jobs.repositorySync') }}</h2>
                <p class="mt-1 text-sm text-muted">{{ $t('jobs.description') }}</p>
              </div>
            </div>

            <div class="grid grid-cols-2 overflow-hidden rounded-lg sm:grid-cols-4" :aria-label="$t('jobs.summary')">
              <div v-for="metric in summaryMetrics" :key="metric.key" class="bg-elevated px-4 py-3">
                <p class="text-xs uppercase tracking-wide text-muted">{{ metric.label }}</p>
                <p class="mt-1 text-2xl font-semibold tabular-nums">{{ metric.value }}</p>
              </div>
            </div>
          </div>

          <div v-if="isAdmin" class="flex border-t border-default md:w-36 md:border-l md:border-t-0">
            <UButton
              block
              class="min-h-24 rounded-none"
              icon="i-lucide-play"
              size="lg"
              :disabled="!summary || summary.idle + summary.failed === 0"
              :label="$t('jobs.runAll')"
              :loading="isPending('all')"
              @click="startAll"
            />
          </div>
        </div>
      </UCard>
    </div>

    <UTable
      sticky
      class="min-h-0 flex-1"
      :columns="columns"
      :data="jobs"
      :empty="$t('jobs.empty')"
      :loading="loading"
      :ui="{ th: 'first:pl-8 bg-neutral-100 dark:bg-neutral-950/20', td: 'first:pl-8' }"
    >
      <template #repository-cell="{ row }">
        <p class="font-medium">{{ row.original.repositoryOwner }}/{{ row.original.repositoryName }}</p>
      </template>
      <template #provider-cell="{ row }">
        <div>
          <p>{{ row.original.providerName }}</p>
          <p class="text-xs text-muted">{{ row.original.providerType }}</p>
        </div>
      </template>
      <template #status-cell="{ row }">
        <UBadge variant="subtle" :color="statusColor(row.original.status)">
          {{ $t(`jobs.status.${row.original.status}`) }}
        </UBadge>
      </template>
      <template #scopes-cell="{ row }">
        <div class="flex flex-wrap gap-1">
          <UBadge v-for="scope in row.original.scopes" :key="scope" color="neutral" variant="outline">
            {{ $t(`jobs.scopes.${scope}`) }}
          </UBadge>
        </div>
      </template>
      <template #progress-cell="{ row }">
        <div v-if="row.original.status === 'RUNNING'" class="min-w-40 space-y-1.5">
          <p class="text-xs text-muted">{{ progressLabel(row.original) }}</p>
          <UProgress
            v-if="row.original.progressTotal !== null && row.original.progressTotal > 0"
            size="xs"
            :aria-label="progressLabel(row.original)"
            :max="row.original.progressTotal"
            :model-value="row.original.progressCurrent ?? 0"
          />
          <UProgress v-else size="xs" :aria-label="progressLabel(row.original)" />
        </div>
        <span v-else class="text-sm text-muted">—</span>
      </template>
      <template #attempt-cell="{ row }">
        <span class="tabular-nums">{{ row.original.attempt }}</span>
      </template>
      <template #requestedAt-cell="{ row }">
        <span class="whitespace-nowrap text-xs text-muted">{{ formatTimestamp(row.original.requestedAt) }}</span>
      </template>
      <template #runAfter-cell="{ row }">
        <span class="whitespace-nowrap text-xs text-muted">{{ formatTimestamp(row.original.runAfter) }}</span>
      </template>
      <template #startedAt-cell="{ row }">
        <span class="whitespace-nowrap text-xs text-muted">{{ formatTimestamp(row.original.startedAt) }}</span>
      </template>
      <template #lastError-cell="{ row }">
        <p v-if="row.original.lastError" class="max-w-72 whitespace-normal text-xs text-error">
          {{ row.original.lastError }}
        </p>
        <span v-else class="text-sm text-muted">—</span>
      </template>
      <template v-if="isAdmin" #actions-header="{ column }">
        <span class="flex justify-end">{{ column.columnDef.header }}</span>
      </template>
      <template v-if="isAdmin" #actions-cell="{ row }">
        <div class="flex justify-end">
          <UButton
            color="neutral"
            variant="soft"
            :aria-label="startLabel(row.original)"
            :disabled="['PENDING', 'RUNNING'].includes(row.original.status)"
            :icon="row.original.status === 'FAILED' ? 'i-lucide-rotate-ccw' : 'i-lucide-play'"
            :label="startLabel(row.original)"
            :loading="isPending(row.original.id)"
            @click="start(row.original)"
          />
        </div>
      </template>
    </UTable>

    <QTablePagination
      v-model:items-per-page="itemsPerPage"
      v-model:page="page"
      class="border-t border-default"
      :total-items="totalItems"
      shortcuts
    />
  </LayoutPage>
</template>

<script setup lang="ts">
import type { TableColumn } from '#ui/types';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import { useModuleApi } from '~/composables/api/module-api';
import { useDateTime } from '~/composables/use-date-time';
import { usePendingActions } from '~/composables/use-pending-actions';
import { useAuthStore } from '~/store/auth';
import type { RepositorySyncJob, RepositorySyncJobStatus, RepositorySyncJobSummary } from '~/types/api/resources';

const refreshIntervalMs = 5_000;
const { t } = useI18n();
const api = useEzRepoApi();
const jobsApi = useModuleApi('jobs/repository-sync');
const auth = useAuthStore();
const { formatDateTime } = useDateTime();
const { isPending, run: runPendingAction } = usePendingActions();
const isAdmin = computed(() => auth.user?.role === 'SYSTEM_ADMIN');
const jobs = ref<RepositorySyncJob[]>([]);
const summary = ref<RepositorySyncJobSummary | null>(null);
const loading = ref(true);
const loadError = ref(false);
const page = ref(1);
const itemsPerPage = ref(10);
const totalItems = ref(0);
let refreshTimer: ReturnType<typeof setInterval> | undefined;

const columns = computed<TableColumn<RepositorySyncJob>[]>(() => [
  { accessorKey: 'repositoryName', header: t('jobs.columns.repository'), id: 'repository' },
  { accessorKey: 'providerName', header: t('jobs.columns.provider'), id: 'provider' },
  { accessorKey: 'status', header: t('jobs.columns.status'), id: 'status' },
  { accessorKey: 'scopes', header: t('jobs.columns.scopes'), id: 'scopes' },
  { accessorKey: 'progressPhase', header: t('jobs.columns.progress'), id: 'progress' },
  { accessorKey: 'attempt', header: t('jobs.columns.attempt'), id: 'attempt' },
  { accessorKey: 'requestedAt', header: t('jobs.columns.requestedAt'), id: 'requestedAt' },
  { accessorKey: 'runAfter', header: t('jobs.columns.runAfter'), id: 'runAfter' },
  { accessorKey: 'startedAt', header: t('jobs.columns.startedAt'), id: 'startedAt' },
  { accessorKey: 'lastError', header: t('jobs.columns.error'), id: 'lastError' },
  ...(isAdmin.value ? [{ header: t('jobs.columns.actions'), id: 'actions' } as TableColumn<RepositorySyncJob>] : []),
]);
const summaryMetrics = computed(() => [
  { key: 'running', label: t('jobs.status.RUNNING'), value: summary.value?.running ?? 0 },
  { key: 'waiting', label: t('jobs.waiting'), value: summary.value?.pending ?? 0 },
  { key: 'failed', label: t('jobs.status.FAILED'), value: summary.value?.failed ?? 0 },
  { key: 'idle', label: t('jobs.status.IDLE'), value: summary.value?.idle ?? 0 },
]);

definePageMeta({ fullWidth: true });
useHead({ title: computed(() => t('jobs.title')) });

/** Load the current queue summary and requested repository page. */
async function load(showLoading = false): Promise<void> {
  if (showLoading) loading.value = true;
  try {
    const [jobsResponse, summaryResponse] = await Promise.all([
      jobsApi.query({ page: page.value, perPage: itemsPerPage.value }),
      api.jobs.summary(),
    ]);
    jobs.value = jobsResponse.data.items;
    totalItems.value = jobsResponse.data.meta.itemCount;
    summary.value = summaryResponse.data;
    loadError.value = false;
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

/** Queue every currently idle or failed repository synchronization. */
async function startAll(): Promise<void> {
  await runPendingAction('all', async () => {
    await api.jobs.startAll();
    await load();
  });
}

/** Queue one idle or failed repository synchronization. */
async function start(job: RepositorySyncJob): Promise<void> {
  await runPendingAction(job.id, async () => {
    await api.jobs.start(job.id);
    await load();
  });
}

/** Return the localized action label for one repository job. */
function startLabel(job: RepositorySyncJob): string {
  return t(job.status === 'FAILED' ? 'jobs.retry' : 'jobs.run');
}

/** Map job states to semantic badge colors. */
function statusColor(status: RepositorySyncJobStatus): 'neutral' | 'info' | 'success' | 'error' {
  if (status === 'RUNNING') return 'success';
  if (status === 'PENDING') return 'info';
  if (status === 'FAILED') return 'error';
  return 'neutral';
}

/** Describe the active synchronization phase and any determinate item count. */
function progressLabel(job: RepositorySyncJob): string {
  const phase = job.progressPhase ? t(`jobs.phases.${job.progressPhase}`) : t('jobs.phases.LOADING_REPOSITORY');
  if (job.progressCurrent === null || job.progressTotal === null) return phase;
  return t('jobs.progressCount', { current: job.progressCurrent, phase, total: job.progressTotal });
}

/** Format an optional persisted job timestamp. */
function formatTimestamp(value: string | null): string {
  return value ? formatDateTime(value) : '—';
}

watch([page, itemsPerPage], () => void load(true));
onMounted(() => {
  void load(true);
  refreshTimer = setInterval(() => void load(), refreshIntervalMs);
});
onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>
