<template>
  <LayoutPage
    :breadcrumbs="[
      { icon: 'i-lucide-layout-dashboard', label: $t('layout.dashboard'), to: '/' },
      { icon: 'i-lucide-shield-alert', label: $t('securityAlerts.title') },
      { icon: kindIcon, label: pageTitle },
    ]"
    :description="$t('securityAlerts.description')"
    :padded="false"
    :title="pageTitle"
  >
    <template #actions>
      <UInput
        v-model="search"
        class="w-40 sm:w-56"
        icon="i-lucide-search"
        :aria-label="$t('securityAlerts.search')"
        :placeholder="$t('securityAlerts.search')"
      />
      <USelectMenu
        v-if="kind === 'CODE'"
        v-model="selectedPath"
        class="w-40"
        :aria-label="$t('securityAlerts.columns.path')"
        :items="filterOptions.paths"
        :placeholder="$t('securityAlerts.columns.path')"
      />
      <UInput v-model="updatedFrom" class="w-36" type="date" :aria-label="$t('workItems.updatedFrom')" />
      <UInput v-model="updatedTo" class="w-36" type="date" :aria-label="$t('workItems.updatedTo')" />
      <UButton
        color="neutral"
        icon="i-lucide-refresh-cw"
        variant="soft"
        :aria-label="$t('dashboard.refresh')"
        :loading="loading || supportingLoading"
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

    <div class="space-y-4 p-4 sm:p-6">
      <UAlert
        v-if="unavailableCount > 0"
        color="warning"
        icon="i-lucide-triangle-alert"
        variant="subtle"
        :description="$t('securityAlerts.unavailableDescription', { count: unavailableCount })"
        :title="$t('securityAlerts.unavailable')"
      />
      <ModulesWorkItemsSummaryCards
        :loading="supportingLoading"
        :metrics="summaryMetrics"
        :title="$t('securityAlerts.openSummary')"
      />
    </div>

    <UAlert
      v-if="tableError || supportingError"
      class="mx-4 mb-4 sm:mx-6"
      color="error"
      icon="i-lucide-circle-alert"
      variant="subtle"
      :title="$t('securityAlerts.loadError')"
    />
    <UTable
      sticky
      v-model:column-pinning="columnPinning"
      class="min-h-0 flex-1 overflow-x-auto"
      :columns="columns"
      :data="items"
      :empty="$t('securityAlerts.empty')"
      :loading="loading"
      :ui="{ th: 'first:pl-6 whitespace-nowrap bg-neutral-100 dark:bg-neutral-950/20', td: 'first:pl-6 align-top' }"
    >
      <template #title-cell="{ row }">
        <NuxtLink class="font-medium hover:underline" :to="`/alerts/${row.original.id}`">
          {{ row.original.title }}
        </NuxtLink>
      </template>
      <template #repositoryName-cell="{ row }">
        {{ row.original.repositoryOwner }}/{{ row.original.repositoryName }}
      </template>
      <template #providerType-cell="{ row }">
        <EnumsProviderTypeBadge variant="subtle" :value="row.original.providerType" />
      </template>
      <template #severity-cell="{ row }">
        <UBadge variant="subtle" :color="severityColor(row.original.severity)">
          {{ $t(`securityAlerts.severities.${row.original.severity}`) }}
        </UBadge>
      </template>
      <template #state-cell="{ row }">
        <UBadge color="neutral" variant="subtle">{{ $t(`securityAlerts.states.${row.original.state}`) }}</UBadge>
      </template>
      <template #providerUpdatedAt-cell="{ row }">
        <span class="whitespace-nowrap text-sm text-muted">{{ formatDateTime(row.original.providerUpdatedAt) }}</span>
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
            :to="row.original.providerUrl"
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
import type {
  ProviderType,
  SecurityAlert,
  SecurityAlertFilterOptions,
  SecurityAlertKind,
  SecurityAlertSeverity,
  SecurityAlertSummary,
} from '~/types/api/resources';
import { providerTypes } from '~/types/api/resources';
import type { ColumnDefinition } from '~/types/table';

const props = defineProps<{ kind: SecurityAlertKind }>();
type AlertRow = SecurityAlert & Record<string, unknown>;
type AlertColumn = ColumnDefinition<AlertRow> & { header: string; id: string };
const { t } = useI18n();
const api = useEzRepoApi();
const route = useRoute();
const { formatDateTime } = useDateTime();
const { getLabel: getProviderTypeLabel } = useProviderType();
const search = ref('');
const selectedPath = ref<string>();
const updatedFrom = ref('');
const updatedTo = ref('');
const debouncedSearch = refDebounced(search, 250);
const summary = ref<SecurityAlertSummary | null>(null);
const filterOptions = ref<SecurityAlertFilterOptions>({
  availability: [],
  ecosystems: [],
  manifests: [],
  packages: [],
  paths: [],
  repositories: [],
  rules: [],
  scanners: [],
  secretProviders: [],
  secretTypes: [],
});
const supportingLoading = ref(true);
const supportingError = ref(false);
const pageTitle = computed(() => t(`securityAlerts.kindTitles.${props.kind}`));
const kindIcon = computed(
  () =>
    ({ DEPENDENCY: 'i-lucide-package-search', CODE: 'i-lucide-file-search-2', SECRET: 'i-lucide-key-round' })[
      props.kind
    ],
);
const unavailableCount = computed(
  () =>
    filterOptions.value.availability.filter(
      ({ availability, kind }) => availability === 'UNAVAILABLE' && kind === props.kind,
    ).length,
);
const columnDefinition = computed<AlertColumn[]>(() => [
  { accessorKey: 'title', header: t('securityAlerts.columns.title'), id: 'title' },
  { accessorKey: 'repositoryName', header: t('securityAlerts.columns.repository'), id: 'repositoryName' },
  { accessorKey: 'providerType', header: t('workItems.provider'), id: 'providerType' },
  { accessorKey: 'severity', header: t('securityAlerts.columns.severity'), id: 'severity' },
  { accessorKey: 'state', header: t('securityAlerts.columns.state'), id: 'state' },
  ...(props.kind === 'DEPENDENCY'
    ? [{ accessorKey: 'packageName', header: t('securityAlerts.columns.package'), id: 'packageName' }]
    : []),
  ...(props.kind === 'CODE'
    ? [{ accessorKey: 'scanner', header: t('securityAlerts.columns.scanner'), id: 'scanner' }]
    : []),
  ...(props.kind === 'SECRET'
    ? [{ accessorKey: 'secretType', header: t('securityAlerts.columns.secretType'), id: 'secretType' }]
    : []),
  { accessorKey: 'providerUpdatedAt', header: t('securityAlerts.columns.updated'), id: 'providerUpdatedAt' },
  { enableHiding: false, header: t('repositories.columns.actions'), id: 'actions' },
]);
const sortableFields = computed<SortingField[]>(() => [
  { label: t('securityAlerts.columns.title'), value: 'title' },
  { label: t('securityAlerts.columns.severity'), value: 'severity' },
  { label: t('securityAlerts.columns.updated'), value: 'providerUpdatedAt' },
]);
const filterFields = computed<FilterField[]>(() => [
  {
    label: t('securityAlerts.columns.state'),
    type: FilterFieldType.Enum,
    value: 'state',
    values: ['OPEN', 'RESOLVED', 'DISMISSED'].map((value) => ({ label: t(`securityAlerts.states.${value}`), value })),
  },
  {
    label: t('securityAlerts.columns.severity'),
    type: FilterFieldType.Enum,
    value: 'severity',
    values: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'UNKNOWN'].map((value) => ({
      label: t(`securityAlerts.severities.${value}`),
      value,
    })),
  },
  {
    label: t('securityAlerts.columns.repository'),
    type: FilterFieldType.Enum,
    value: 'repositoryId',
    values: filterOptions.value.repositories.map(({ id, name, owner }) => ({ label: `${owner}/${name}`, value: id })),
  },
  {
    label: t('workItems.provider'),
    type: FilterFieldType.Enum,
    value: 'repository.providerAccount.providerType',
    values: providerTypes.map((value: ProviderType) => ({ label: getProviderTypeLabel(value), value })),
  },
  ...(props.kind === 'DEPENDENCY'
    ? [
        {
          label: t('securityAlerts.columns.ecosystem'),
          type: FilterFieldType.Enum,
          value: 'ecosystem',
          values: filterOptions.value.ecosystems.map((value) => ({ label: value, value })),
        },
        {
          label: t('securityAlerts.columns.package'),
          type: FilterFieldType.Enum,
          value: 'packageName',
          values: filterOptions.value.packages.map((value) => ({ label: value, value })),
        },
        {
          label: t('securityAlerts.columns.manifest'),
          type: FilterFieldType.Enum,
          value: 'manifest',
          values: filterOptions.value.manifests.map((value) => ({ label: value, value })),
        },
      ]
    : props.kind === 'CODE'
      ? [
          {
            label: t('securityAlerts.columns.scanner'),
            type: FilterFieldType.Enum,
            value: 'scanner',
            values: filterOptions.value.scanners.map((value) => ({ label: value, value })),
          },
          {
            label: t('securityAlerts.columns.rule'),
            type: FilterFieldType.Enum,
            value: 'ruleId',
            values: filterOptions.value.rules.map((value) => ({ label: value, value })),
          },
        ]
      : [
          {
            label: t('securityAlerts.columns.secretType'),
            type: FilterFieldType.Enum,
            value: 'secretType',
            values: filterOptions.value.secretTypes.map((value) => ({ label: value, value })),
          },
          {
            label: t('securityAlerts.columns.secretProvider'),
            type: FilterFieldType.Enum,
            value: 'secretProvider',
            values: filterOptions.value.secretProviders.map((value) => ({ label: value, value })),
          },
        ]),
]);
const staticFilter = computed(() => ({
  AND: [
    { kind: props.kind },
    ...(typeof route.query.repositoryId === 'string' ? [{ repositoryId: route.query.repositoryId }] : []),
    ...(selectedPath.value ? [{ location: { path: ['path'], equals: selectedPath.value } }] : []),
    ...(updatedFrom.value
      ? [{ providerUpdatedAt: { gte: new Date(`${updatedFrom.value}T00:00:00.000Z`).toISOString() } }]
      : []),
    ...(updatedTo.value
      ? [{ providerUpdatedAt: { lte: new Date(`${updatedTo.value}T23:59:59.999Z`).toISOString() } }]
      : []),
    ...(debouncedSearch.value.trim()
      ? [
          {
            OR: [
              { title: { contains: debouncedSearch.value.trim(), mode: 'insensitive' } },
              { packageName: { contains: debouncedSearch.value.trim(), mode: 'insensitive' } },
              { ruleId: { contains: debouncedSearch.value.trim(), mode: 'insensitive' } },
              { secretType: { contains: debouncedSearch.value.trim(), mode: 'insensitive' } },
            ],
          },
        ]
      : []),
  ],
}));
const table = useTable({
  columnDefinition,
  defaultItemsPerPage: 25,
  endpoint: 'security-alerts',
  name: `security-alerts-${props.kind.toLocaleLowerCase()}`,
  staticFields: ['id', 'repositoryOwner', 'providerUrl'],
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
const summaryMetrics = computed(() => [
  { icon: kindIcon.value, label: t('securityAlerts.open'), value: String(summary.value?.open[props.kind] ?? '—') },
  {
    icon: 'i-lucide-octagon-alert',
    label: t('securityAlerts.severities.CRITICAL'),
    value: String(summary.value?.severity.CRITICAL ?? '—'),
  },
  {
    icon: 'i-lucide-triangle-alert',
    label: t('securityAlerts.severities.HIGH'),
    value: String(summary.value?.severity.HIGH ?? '—'),
  },
  {
    icon: 'i-lucide-circle-alert',
    label: t('securityAlerts.unavailable'),
    value: String(summary.value?.unavailableRepositories ?? '—'),
  },
]);
async function loadSupportingData(): Promise<void> {
  supportingLoading.value = true;
  const [summaryResult, optionsResult] = await Promise.allSettled([
    api.securityAlerts.summary(),
    api.securityAlerts.filterOptions(),
  ]);
  if (summaryResult.status === 'fulfilled') summary.value = summaryResult.value.data;
  if (optionsResult.status === 'fulfilled') filterOptions.value = optionsResult.value.data;
  supportingError.value = summaryResult.status === 'rejected' || optionsResult.status === 'rejected';
  supportingLoading.value = false;
}
async function refreshAll(): Promise<void> {
  await Promise.all([refresh(), loadSupportingData()]);
}
function severityColor(severity: SecurityAlertSeverity): 'error' | 'warning' | 'info' | 'neutral' {
  if (severity === 'CRITICAL' || severity === 'HIGH') return 'error';
  if (severity === 'MEDIUM') return 'warning';
  if (severity === 'LOW' || severity === 'INFO') return 'info';
  return 'neutral';
}
onMounted(() => {
  void initialize();
  void loadSupportingData();
});
</script>
