<template>
  <LayoutPage
    :breadcrumbs="[
      { icon: 'i-lucide-layout-dashboard', label: $t('layout.dashboard'), to: '/' },
      { icon: kindIcon, label: pageTitle },
    ]"
    :description="pageDescription"
    :padded="false"
    :title="pageTitle"
  >
    <template #actions>
      <UInput
        v-model="search"
        class="w-40 sm:w-56"
        icon="i-lucide-search"
        :aria-label="$t('workItems.search')"
        :placeholder="$t('workItems.searchPlaceholder')"
      />
      <USelectMenu
        v-model="selectedLabels"
        multiple
        class="w-40"
        :items="filterOptions.labels"
        :placeholder="$t('workItems.labels')"
        :aria-label="$t('workItems.labels')"
      />
      <UInput v-model="updatedFrom" class="w-36" type="date" :aria-label="$t('workItems.updatedFrom')" />
      <UInput v-model="updatedTo" class="w-36" type="date" :aria-label="$t('workItems.updatedTo')" />
      <UButton
        color="neutral"
        icon="i-lucide-refresh-cw"
        variant="soft"
        :aria-label="$t('dashboard.refresh')"
        :loading="loading || summaryLoading"
        @click="refreshAll"
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

    <div class="p-4 sm:p-6">
      <ModulesWorkItemsSummaryCards
        :loading="summaryLoading"
        :metrics="summaryMetrics"
        :title="$t('workItems.summary')"
      />
    </div>
    <UAlert
      v-if="tableError || summaryError"
      class="mx-4 mb-4 sm:mx-6"
      color="error"
      icon="i-lucide-circle-alert"
      variant="subtle"
      :title="$t('workItems.loadError')"
    />
    <UTable
      sticky
      v-model:column-pinning="columnPinning"
      class="min-h-0 flex-1 overflow-x-auto"
      :columns="columns"
      :data="items"
      :empty="$t('workItems.empty')"
      :loading="loading"
      :ui="{ th: 'first:pl-6 whitespace-nowrap bg-neutral-100 dark:bg-neutral-950/20', td: 'first:pl-6 align-top' }"
    >
      <template #number-cell="{ row }">
        <span class="font-mono text-xs">#{{ row.original.number }}</span>
      </template>
      <template #title-cell="{ row }">
        <NuxtLink class="font-medium hover:underline" :to="`/${endpoint}/${row.original.id}`">
          {{ row.original.title }}
        </NuxtLink>
      </template>
      <template #repositoryName-cell="{ row }">
        {{ row.original.repositoryOwner }}/{{ row.original.repositoryName }}
      </template>
      <template #providerType-cell="{ row }">
        <EnumsProviderTypeBadge variant="subtle" :value="row.original.providerType" />
      </template>
      <template #state-cell="{ row }">
        <UBadge color="neutral" variant="subtle">{{ $t(`workItems.states.${row.original.state}`) }}</UBadge>
      </template>
      <template #author-cell="{ row }">{{ row.original.author?.username ?? '—' }}</template>
      <template #labels-cell="{ row }"><ModulesWorkItemsLabels :labels="row.original.labels" /></template>
      <template #providerUpdatedAt-cell="{ row }">
        <span class="whitespace-nowrap text-sm text-muted">{{ formatDateTime(row.original.providerUpdatedAt) }}</span>
      </template>
      <template #workflowStatus-cell="{ row }">
        <UBadge
          v-if="'workflowStatus' in row.original"
          variant="subtle"
          :color="row.original.workflowStatus === 'FAILED' ? 'error' : 'neutral'"
        >
          {{ $t(`workItems.workflowStatuses.${row.original.workflowStatus}`) }}
        </UBadge>
      </template>
      <template #workflowApprovalRequired-cell="{ row }">
        <UBadge
          v-if="'workflowApprovalRequired' in row.original && row.original.workflowApprovalRequired"
          color="warning"
          variant="subtle"
        >
          {{ $t('pullRequests.approvalRequired') }}
        </UBadge>
        <span v-else>—</span>
      </template>
      <template #actions-cell="{ row }">
        <div class="flex justify-end">
          <UButton
            color="neutral"
            icon="i-tabler-external-link"
            rel="noreferrer"
            target="_blank"
            variant="ghost"
            :aria-label="$t('dashboard.openProvider')"
            :to="row.original.url"
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
import { FilterFieldType, type FilterField, type SortingField } from '@querry-kit/nuxt-ui/types';
import { refDebounced } from '@vueuse/core';
import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import { useTable } from '~/composables/api/table';
import { useProviderType } from '~/composables/enums/provider-type';
import { useDateTime } from '~/composables/use-date-time';
import {
  providerTypes,
  type Issue,
  type IssueSummary,
  type PullRequest,
  type PullRequestSummary,
  type WorkItemFilterOptions,
} from '~/types/api/resources';
import type { ColumnDefinition } from '~/types/table';
import { loadWorkflowRunRepositoryFilterOptions } from '~/utils/workflow-run-filtering';

const props = defineProps<{ kind: 'issue' | 'pull-request' }>();
type WorkItemRow = (Issue | PullRequest) & Record<string, unknown>;
type WorkItemTableColumn = ColumnDefinition<WorkItemRow> & { header: string; id: string };
const { t } = useI18n();
const api = useEzRepoApi();
const { formatDateTime } = useDateTime();
const { getLabel: getProviderTypeLabel } = useProviderType();
const search = ref('');
const debouncedSearch = refDebounced(search, 250);
const selectedLabels = ref<string[]>([]);
const updatedFrom = ref('');
const updatedTo = ref('');
const filterOptions = ref<WorkItemFilterOptions>({ assignees: [], authors: [], labels: [], milestones: [] });
const repositories = ref<Array<{ label: string; value: string }>>([]);
const summary = ref<IssueSummary | PullRequestSummary | null>(null);
const summaryLoading = ref(true);
const summaryError = ref(false);
const endpoint: 'issues' | 'pull-requests' = props.kind === 'issue' ? 'issues' : 'pull-requests';
const pageTitle = computed(() => t(props.kind === 'issue' ? 'issues.title' : 'pullRequests.title'));
const pageDescription = computed(() => t(props.kind === 'issue' ? 'issues.description' : 'pullRequests.description'));
const kindIcon = computed(() => (props.kind === 'issue' ? 'i-tabler-circle-dot' : 'i-tabler-git-pull-request'));

const columnDefinition = computed<WorkItemTableColumn[]>(() => [
  { accessorKey: 'number', header: t('workItems.columns.number'), id: 'number' },
  { accessorKey: 'title', header: t('workItems.columns.title'), id: 'title' },
  { accessorKey: 'repositoryName', header: t('repositories.columns.name'), id: 'repositoryName' },
  { accessorKey: 'providerType', header: t('repositories.addSteps.provider'), id: 'providerType' },
  { accessorKey: 'state', header: t('workItems.columns.state'), id: 'state' },
  { accessorKey: 'author', header: t('workItems.columns.author'), id: 'author' },
  { accessorKey: 'labels', header: t('workItems.labels'), id: 'labels' },
  ...(props.kind === 'pull-request'
    ? [
        { accessorKey: 'workflowStatus', header: t('pullRequests.workflowStatus'), id: 'workflowStatus' },
        { accessorKey: 'workflowApprovalRequired', header: t('pullRequests.approval'), id: 'workflowApprovalRequired' },
      ]
    : []),
  { accessorKey: 'providerUpdatedAt', header: t('workItems.columns.updated'), id: 'providerUpdatedAt' },
  { enableHiding: false, header: t('repositories.columns.actions'), id: 'actions' },
]);
const sortableFields = computed<SortingField[]>(() => [
  { label: t('workItems.columns.number'), value: 'number' },
  { label: t('workItems.columns.title'), value: 'title' },
  { label: t('workItems.columns.updated'), value: 'providerUpdatedAt' },
]);
const filterFields = computed<FilterField[]>(() => [
  {
    label: t('workItems.columns.state'),
    type: FilterFieldType.Enum,
    value: 'state',
    values: (props.kind === 'issue' ? ['OPEN', 'CLOSED'] : ['OPEN', 'CLOSED', 'MERGED']).map((state) => ({
      label: t(`workItems.states.${state}`),
      value: state,
    })),
  },
  { label: t('workItems.repository'), type: FilterFieldType.Enum, value: 'repositoryId', values: repositories.value },
  {
    label: t('workItems.provider'),
    type: FilterFieldType.Enum,
    value: 'repository.providerAccount.providerType',
    values: providerTypes.map((value) => ({ label: getProviderTypeLabel(value), value })),
  },
  {
    label: t('workItems.columns.author'),
    type: FilterFieldType.Enum,
    value: 'author.username',
    values: filterOptions.value.authors.map((value) => ({ label: value, value })),
  },
  {
    label: t('workItems.assignee'),
    type: FilterFieldType.Enum,
    value: 'assignees.some.actor.username',
    values: filterOptions.value.assignees.map((value) => ({ label: value, value })),
  },
  ...(props.kind === 'issue'
    ? [
        {
          label: t('workItems.milestone'),
          type: FilterFieldType.Enum,
          value: 'milestone',
          values: filterOptions.value.milestones.map((value) => ({ label: value, value })),
        },
      ]
    : [
        { label: t('pullRequests.draft'), type: FilterFieldType.Boolean, value: 'draft' },
        {
          label: t('pullRequests.workflowStatus'),
          type: FilterFieldType.Enum,
          value: 'workflowStatus',
          values: ['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED', 'UNKNOWN'].map((value) => ({
            label: t(`workItems.workflowStatuses.${value}`),
            value,
          })),
        },
        { label: t('pullRequests.approval'), type: FilterFieldType.Boolean, value: 'workflowApprovalRequired' },
      ]),
]);
const staticFilter = computed(() => {
  const constraints: Record<string, unknown>[] = selectedLabels.value.map((name) => ({
    labels: { some: { label: { normalizedName: name.toLocaleLowerCase() } } },
  }));
  const value = debouncedSearch.value.trim();
  if (value)
    constraints.push({ OR: [{ number: { contains: value } }, { title: { contains: value, mode: 'insensitive' } }] });
  if (updatedFrom.value)
    constraints.push({ providerUpdatedAt: { gte: new Date(`${updatedFrom.value}T00:00:00.000Z`).toISOString() } });
  if (updatedTo.value)
    constraints.push({ providerUpdatedAt: { lte: new Date(`${updatedTo.value}T23:59:59.999Z`).toISOString() } });
  return constraints.length > 0 ? { AND: constraints } : undefined;
});
const table = useTable({
  columnDefinition,
  defaultItemsPerPage: 25,
  endpoint,
  name: endpoint,
  staticFields: ['id', 'repositoryOwner', 'url'],
  staticFilter,
});
const {
  columnOrder,
  columnPinning,
  columnVisibility,
  columns,
  error: tableError,
  filtering,
  initialize,
  items,
  itemsPerPage,
  loading,
  page,
  refresh,
  sorting,
  totalItems,
} = table;
const summaryMetrics = computed(() =>
  props.kind === 'issue'
    ? [
        ['issues.open', (summary.value as IssueSummary | null)?.open, 'i-tabler-circle-dot'],
        ['issues.recent', (summary.value as IssueSummary | null)?.recentlyUpdated, 'i-lucide-clock'],
        ['issues.assigned', (summary.value as IssueSummary | null)?.assigned, 'i-lucide-user-check'],
        ['issues.stale', (summary.value as IssueSummary | null)?.stale, 'i-lucide-hourglass'],
      ].map(([label, value, icon]) => ({ icon: String(icon), label: t(String(label)), value: String(value ?? '—') }))
    : [
        ['pullRequests.open', (summary.value as PullRequestSummary | null)?.open, 'i-tabler-git-pull-request'],
        ['pullRequests.drafts', (summary.value as PullRequestSummary | null)?.drafts, 'i-lucide-file-pen'],
        ['pullRequests.failed', (summary.value as PullRequestSummary | null)?.failedWorkflows, 'i-lucide-circle-alert'],
        [
          'pullRequests.approvalRequired',
          (summary.value as PullRequestSummary | null)?.workflowApprovalRequired,
          'i-lucide-shield-alert',
        ],
      ].map(([label, value, icon]) => ({ icon: String(icon), label: t(String(label)), value: String(value ?? '—') })),
);

async function loadSupportingData(): Promise<void> {
  summaryLoading.value = true;
  summaryError.value = false;
  const [optionsResult, repositoriesResult, summaryResult] = await Promise.allSettled([
    props.kind === 'issue' ? api.issues.filterOptions() : api.pullRequests.filterOptions(),
    loadWorkflowRunRepositoryFilterOptions((page) => api.repositories.list(page).then((response) => response.data)),
    props.kind === 'issue' ? api.issues.summary() : api.pullRequests.summary(),
  ]);
  if (optionsResult.status === 'fulfilled') filterOptions.value = optionsResult.value.data;
  if (repositoriesResult.status === 'fulfilled') repositories.value = repositoriesResult.value;
  if (summaryResult.status === 'fulfilled') summary.value = summaryResult.value.data;
  summaryError.value = [optionsResult, repositoriesResult, summaryResult].some(
    (result) => result.status === 'rejected',
  );
  summaryLoading.value = false;
}
async function refreshAll(): Promise<void> {
  await Promise.all([refresh(), loadSupportingData()]);
}
onMounted(() => Promise.all([initialize(), loadSupportingData()]));
</script>
