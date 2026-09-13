<template>
  <LayoutPage :breadcrumbs="breadcrumbs" :padded="false" :title="title">
    <template #actions>
      <UInput
        v-if="searchable"
        v-model="search"
        class="w-36 sm:w-56"
        icon="i-lucide-search"
        :aria-label="$t('workflowRuns.search')"
        :placeholder="$t('workflowRuns.searchPlaceholder')"
      />
      <UButton
        color="neutral"
        icon="i-lucide-refresh-cw"
        variant="soft"
        :aria-label="$t('dashboard.refresh')"
        :loading="loading"
        @click="refresh"
      />
      <QTableSorting v-model:sorting="sorting" :fields="sortableFields" shortcuts />
      <QTableFiltering v-model:filtering="filtering" :fields="filterFields" shortcuts />
      <QTableOptions
        v-model:column-order="columnOrder"
        v-model:column-pinning="columnPinning"
        v-model:invisible-columns="columnVisibility"
        :columns="columnDefinition"
        shortcuts
      />
    </template>

    <UAlert
      v-if="tableError"
      class="m-4"
      color="error"
      icon="i-lucide-circle-alert"
      variant="subtle"
      :title="loadError"
    />
    <UTable
      sticky
      v-model:column-pinning="columnPinning"
      class="min-h-0 flex-1 overflow-x-auto"
      :columns="columns"
      :data="items"
      :empty="empty"
      :loading="loading"
      :ui="{
        th: 'first:pl-6 whitespace-nowrap bg-neutral-100 dark:bg-neutral-950/20',
        td: 'first:pl-6 whitespace-nowrap',
      }"
    >
      <template #displayTitle-cell="{ row }">
        <span class="font-medium">{{ row.original.displayTitle }}</span>
      </template>
      <template #workflowName-cell="{ row }">
        <span class="text-sm text-muted">{{ row.original.workflowName }}</span>
      </template>
      <template #repositoryName-cell="{ row }">
        <span>{{ row.original.repositoryOwner }}/{{ row.original.repositoryName }}</span>
      </template>
      <template #providerType-cell="{ row }">
        <EnumsProviderTypeBadge variant="subtle" :value="row.original.providerType" />
      </template>
      <template #status-cell="{ row }">
        <UBadge variant="subtle" :color="statusColor(row.original.status)">
          {{ $t(`workflowStatus.${row.original.status}`) }}
        </UBadge>
      </template>
      <template #providerCreatedAt-cell="{ row }">
        <span class="whitespace-nowrap text-sm text-muted">{{ formatTimestamp(row.original.providerCreatedAt) }}</span>
      </template>
      <template #startedAt-cell="{ row }">
        <span class="whitespace-nowrap text-sm text-muted">{{ formatTimestamp(row.original.startedAt) }}</span>
      </template>
      <template #completedAt-cell="{ row }">
        <span class="whitespace-nowrap text-sm text-muted">{{ formatTimestamp(row.original.completedAt) }}</span>
      </template>
      <template #durationMs-cell="{ row }">
        <span class="whitespace-nowrap text-sm text-muted">{{ formatDuration(row.original.durationMs) }}</span>
      </template>
      <template #actions-header="{ column }">
        <span class="flex justify-end">{{ column.columnDef.header }}</span>
      </template>
      <template #actions-cell="{ row }">
        <div class="flex justify-end">
          <UTooltip :text="$t('dashboard.openProvider')">
            <UButton
              color="neutral"
              icon="i-tabler-external-link"
              rel="noreferrer"
              target="_blank"
              variant="ghost"
              :aria-label="$t('dashboard.openProvider')"
              :to="row.original.url"
            />
          </UTooltip>
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { FilterFieldType, type FilterField, type Filtering, type SortingField } from '@querry-kit/nuxt-ui/types';
import { refDebounced } from '@vueuse/core';
import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import { useSystemStatusState } from '~/composables/api/system-status';
import { useTable } from '~/composables/api/table';
import { useProviderType } from '~/composables/enums/provider-type';
import { useDateTime } from '~/composables/use-date-time';
import { providerTypes, type WorkflowRun, type WorkflowRunStatus } from '~/types/api/resources';
import type { ColumnDefinition } from '~/types/table';
import {
  durationFilteringToMilliseconds,
  durationFilteringToSeconds,
  loadWorkflowRunRepositoryFilterOptions,
  type WorkflowRunRepositoryFilterOption,
} from '~/utils/workflow-run-filtering';

interface BreadcrumbItem {
  icon: string;
  label: string;
  to?: string;
}

type WorkflowRunRow = WorkflowRun & Record<string, unknown>;
type WorkflowRunTableColumn = ColumnDefinition<WorkflowRunRow> & { header: string; id: string };

const props = defineProps<{
  breadcrumbs: BreadcrumbItem[];
  detailedTimestamps?: boolean;
  empty: string;
  endpoint: 'workflow-runs' | 'workflow-runs/needs-attention';
  loadError: string;
  name: string;
  searchable?: boolean;
  title: string;
}>();

const { t } = useI18n();
const { formatDateTime } = useDateTime();
const api = useEzRepoApi();
const toast = useToast();
const { snapshot: systemStatus } = useSystemStatusState();
const { getLabel: getProviderTypeLabel } = useProviderType();
const search = ref('');
const debouncedSearch = refDebounced(search, 250);
const repositoryFilterLoading = ref(true);
const repositoryFilterOptions = ref<WorkflowRunRepositoryFilterOption[]>([]);
const workflowStatuses: WorkflowRunStatus[] = [
  'QUEUED',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'CANCELLED',
  'SKIPPED',
  'UNKNOWN',
];
const columnDefinition = computed<WorkflowRunTableColumn[]>(() => [
  { accessorKey: 'displayTitle', header: t('workflowRuns.columns.title'), id: 'displayTitle' },
  { accessorKey: 'workflowName', header: t('workflowRuns.columns.workflow'), id: 'workflowName' },
  { accessorKey: 'repositoryName', header: t('repositories.columns.name'), id: 'repositoryName' },
  { accessorKey: 'providerType', header: t('repositories.addSteps.provider'), id: 'providerType' },
  { accessorKey: 'status', header: t('workflowRuns.columns.status'), id: 'status' },
  ...(props.detailedTimestamps
    ? [
        { accessorKey: 'providerCreatedAt', header: t('workflowRuns.columns.created'), id: 'providerCreatedAt' },
        { accessorKey: 'startedAt', header: t('workflowRuns.columns.started'), id: 'startedAt' },
      ]
    : []),
  { accessorKey: 'durationMs', header: t('workflowRuns.columns.duration'), id: 'durationMs' },
  { accessorKey: 'completedAt', header: t('workflowRuns.columns.completed'), id: 'completedAt' },
  { enableHiding: false, header: t('repositories.columns.actions'), id: 'actions' },
]);
const sortableFields = computed<SortingField[]>(() => [
  { label: t('workflowRuns.columns.title'), value: 'displayTitle' },
  { label: t('workflowRuns.columns.workflow'), value: 'workflowName' },
  { label: t('workflowRuns.columns.status'), value: 'status' },
  ...(props.detailedTimestamps
    ? [
        { label: t('workflowRuns.columns.created'), value: 'providerCreatedAt' },
        { label: t('workflowRuns.columns.started'), value: 'startedAt' },
      ]
    : []),
  { label: t('workflowRuns.columns.duration'), value: 'durationMs' },
  { label: t('workflowRuns.columns.completed'), value: 'completedAt' },
]);
const filterFields = computed<FilterField[]>(() => [
  {
    label: t('workflowRuns.columns.status'),
    type: FilterFieldType.Enum,
    value: 'status',
    values: workflowStatuses.map((status) => ({ label: t(`workflowStatus.${status}`), value: status })),
  },
  {
    disabled: repositoryFilterLoading.value || repositoryFilterOptions.value.length === 0,
    label: t('workflowRuns.filters.repository'),
    type: FilterFieldType.Enum,
    value: 'repositoryId',
    values: repositoryFilterOptions.value,
  },
  {
    label: t('workflowRuns.filters.provider'),
    type: FilterFieldType.Enum,
    value: 'repository.providerAccount.providerType',
    values: providerTypes.map((providerType) => ({ label: getProviderTypeLabel(providerType), value: providerType })),
  },
  {
    label: t('workflowRuns.filters.durationSeconds'),
    type: FilterFieldType.Number,
    value: 'durationMs',
  },
]);
const staticFilter = computed(() => {
  const value = debouncedSearch.value.trim();
  if (!props.searchable || !value) return undefined;
  const contains = { contains: value, mode: 'insensitive' };
  return {
    OR: [
      { displayTitle: contains },
      { workflowName: contains },
      { repository: { name: contains } },
      { repository: { owner: contains } },
    ],
  };
});
const workflowRunTable = useTable({
  columnDefinition,
  defaultItemsPerPage: 25,
  endpoint: props.endpoint,
  name: props.name,
  staticFields: ['id', 'repositoryOwner', 'url'],
  staticFilter,
});
const {
  columnOrder,
  columnVisibility,
  columns,
  error: tableError,
  filtering: queryFiltering,
  items,
  itemsPerPage,
  loading,
  page,
  refresh,
  sorting,
  totalItems,
} = workflowRunTable;
const filtering = computed<Filtering>({
  get: () => durationFilteringToSeconds(queryFiltering.value),
  set: (value) => {
    queryFiltering.value = durationFilteringToMilliseconds(value);
  },
});
const columnPinning = computed({
  get: () => ({ left: workflowRunTable.columnPinning.value.left, right: workflowRunTable.columnPinning.value.right }),
  set: (value: { left?: string[]; right?: string[] }) => {
    workflowRunTable.columnPinning.value = value;
  },
});
let observedProviderSync = false;
let refreshAfterSyncTimer: ReturnType<typeof setTimeout> | undefined;

watch(debouncedSearch, () => {
  page.value = 1;
});
watch(
  queryFiltering,
  () => {
    page.value = 1;
  },
  { deep: true },
);
watch(
  () => systemStatus.value.activity,
  (activity) => {
    if (activity) {
      observedProviderSync = true;
      if (refreshAfterSyncTimer) clearTimeout(refreshAfterSyncTimer);
      refreshAfterSyncTimer = undefined;
      return;
    }
    if (!observedProviderSync) return;
    observedProviderSync = false;
    refreshAfterSyncTimer = setTimeout(() => {
      refreshAfterSyncTimer = undefined;
      void refresh();
    }, 500);
  },
);

/** Load all repositories visible to the current user for the repository filter. */
async function loadRepositoryFilterOptions(): Promise<void> {
  repositoryFilterLoading.value = true;
  try {
    repositoryFilterOptions.value = await loadWorkflowRunRepositoryFilterOptions(async (repositoryPage) => {
      const response = await api.repositories.list(repositoryPage);
      return response.data;
    });
  } catch {
    repositoryFilterOptions.value = [];
    toast.add({ color: 'error', title: t('workflowRuns.repositoryFilterLoadError') });
  } finally {
    repositoryFilterLoading.value = false;
  }
}

/** Format a provider timestamp in the active interface locale. */
function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return t('workflowRuns.notAvailable');
  return formatDateTime(timestamp);
}

/** Format a persisted duration as a compact, readable minutes-and-seconds value. */
function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return t('workflowRuns.notAvailable');
  const seconds = Math.floor(durationMs / 1_000);
  return t('workflowRuns.durationValue', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 });
}

/** Choose a compact semantic badge color for every normalized workflow status. */
function statusColor(status: WorkflowRunStatus): 'error' | 'info' | 'neutral' | 'success' | 'warning' {
  if (status === 'SUCCESS') return 'success';
  if (status === 'FAILED') return 'error';
  if (status === 'RUNNING' || status === 'QUEUED') return 'info';
  if (status === 'CANCELLED' || status === 'SKIPPED') return 'warning';
  return 'neutral';
}

onMounted(() => {
  void workflowRunTable.initialize();
  void loadRepositoryFilterOptions();
});
onBeforeUnmount(() => {
  if (refreshAfterSyncTimer) clearTimeout(refreshAfterSyncTimer);
});
</script>
