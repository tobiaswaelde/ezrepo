<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex flex-wrap items-center justify-end gap-2 border-b border-default p-3 sm:px-4">
      <QTableSorting v-model:sorting="sorting" :fields="sortableFields" shortcuts />
      <QTableFiltering v-model:filtering="filtering" :fields="filterFields" shortcuts />
      <QTableOptions
        v-model:column-order="columnOrder"
        v-model:column-pinning="columnPinning"
        v-model:invisible-columns="columnVisibility"
        :columns="columnDefinition"
        shortcuts
      />
    </div>
    <UAlert
      v-if="tableError"
      class="m-4"
      color="error"
      icon="i-lucide-circle-alert"
      variant="subtle"
      :title="$t('notifications.loadError')"
    />
    <UTable
      sticky
      v-model:column-pinning="columnPinning"
      class="min-h-0 flex-1"
      :columns="columns"
      :data="items"
      :empty="$t('notifications.historyView.empty')"
      :loading="loading"
      :ui="{ th: 'first:pl-8 bg-neutral-100 dark:bg-neutral-950/20', td: 'first:pl-8' }"
    >
      <template #createdAt-cell="{ row }">
        <span class="whitespace-nowrap text-sm">{{ formatDateTime(row.original.createdAt) }}</span>
      </template>
      <template #kind-cell="{ row }">
        <UBadge color="neutral" variant="outline">{{ $t(`notifications.deliveryKinds.${row.original.kind}`) }}</UBadge>
      </template>
      <template #eventType-cell="{ row }">
        <span>{{ row.original.eventType ? $t(`notifications.events.${row.original.eventType}`) : '—' }}</span>
      </template>
      <template #repositoryName-cell="{ row }">
        <span v-if="row.original.repositoryName" class="font-medium">
          {{ row.original.repositoryOwner }}/{{ row.original.repositoryName }}
        </span>
        <span v-else>—</span>
      </template>
      <template #subjectTitle-cell="{ row }">
        <UButton
          v-if="row.original.subjectUrl"
          color="neutral"
          trailing-icon="i-lucide-external-link"
          variant="link"
          target="_blank"
          :label="row.original.subjectTitle ?? '—'"
          :to="row.original.subjectUrl"
        />
        <span v-else>{{ row.original.subjectTitle ?? '—' }}</span>
      </template>
      <template #status-cell="{ row }">
        <UBadge variant="subtle" :color="statusColor(row.original.status)">
          {{ $t(`notificationDeliveryStatus.${row.original.status}`) }}
        </UBadge>
      </template>
      <template #attempts-cell="{ row }">
        <span class="tabular-nums">{{ row.original.attempts.length }}</span>
      </template>
      <template #nextAttemptAt-cell="{ row }">
        <span class="whitespace-nowrap text-sm text-muted">
          {{ row.original.nextAttemptAt ? formatDateTime(row.original.nextAttemptAt) : '—' }}
        </span>
      </template>
      <template #finalError-cell="{ row }">
        <span class="line-clamp-2 max-w-72 text-sm text-error">{{ row.original.finalError ?? '—' }}</span>
      </template>
      <template #actions-header="{ column }">
        <span class="flex justify-end">{{ column.columnDef.header }}</span>
      </template>
      <template #actions-cell="{ row }">
        <div class="flex justify-end">
          <UButton
            color="neutral"
            icon="i-lucide-eye"
            variant="ghost"
            :aria-label="$t('notifications.historyView.details')"
            @click="openDetails(row.original)"
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
    <ModulesNotificationsDeliveryDetailsDialog v-model:open="detailsOpen" :delivery="selectedDelivery" />
  </div>
</template>

<script setup lang="ts">
import { FilterFieldType, type FilterField, type SortingField } from '@querry-kit/nuxt-ui/types';
import { computed, onMounted, ref } from 'vue';
import { useTable } from '~/composables/api/table';
import { useDateTime } from '~/composables/use-date-time';
import type { NotificationDelivery, NotificationDeliveryStatus } from '~/types/api/resources';
import type { ColumnDefinition } from '~/types/table';

definePageMeta({ middleware: 'admin' });

type DeliveryRow = NotificationDelivery & Record<string, unknown>;
type DeliveryColumn = ColumnDefinition<DeliveryRow> & { header: string; id: string };
const { t } = useI18n();
const { formatDateTime } = useDateTime();
const detailsOpen = ref(false);
const selectedDelivery = ref<NotificationDelivery | null>(null);
const columnDefinition = computed<DeliveryColumn[]>(() => [
  { accessorKey: 'createdAt', header: t('notifications.columns.createdAt'), id: 'createdAt' },
  { accessorKey: 'kind', header: t('notifications.columns.kind'), id: 'kind' },
  { accessorKey: 'eventType', header: t('notifications.columns.event'), id: 'eventType' },
  { accessorKey: 'repositoryName', header: t('notifications.columns.repository'), id: 'repositoryName' },
  { accessorKey: 'subjectTitle', header: t('notifications.columns.subject'), id: 'subjectTitle' },
  { accessorKey: 'notificationChannelName', header: t('notifications.columns.channel'), id: 'notificationChannelName' },
  { accessorKey: 'status', header: t('notifications.columns.status'), id: 'status' },
  { header: t('notifications.columns.attempts'), id: 'attempts' },
  { accessorKey: 'nextAttemptAt', header: t('notifications.columns.nextAttempt'), id: 'nextAttemptAt' },
  { accessorKey: 'finalError', header: t('notifications.columns.error'), id: 'finalError' },
  { enableHiding: false, header: t('notifications.columns.actions'), id: 'actions' },
]);
const sortableFields = computed<SortingField[]>(() => [
  { label: t('notifications.columns.createdAt'), value: 'createdAt' },
  { label: t('notifications.columns.kind'), value: 'kind' },
  { label: t('notifications.columns.status'), value: 'status' },
  { label: t('notifications.columns.nextAttempt'), value: 'nextAttemptAt' },
]);
const filterFields = computed<FilterField[]>(() => [
  {
    label: t('notifications.columns.kind'),
    type: FilterFieldType.Enum,
    value: 'kind',
    values: ['EVENT', 'TEST'].map((value) => ({ label: t(`notifications.deliveryKinds.${value}`), value })),
  },
  {
    label: t('notifications.columns.status'),
    type: FilterFieldType.Enum,
    value: 'status',
    values: ['PENDING', 'DELIVERED', 'FAILED'].map((value) => ({
      label: t(`notificationDeliveryStatus.${value}`),
      value,
    })),
  },
]);
const deliveryTable = useTable({
  columnDefinition,
  defaultItemsPerPage: 10,
  endpoint: 'notification-deliveries/query',
  name: 'notification-deliveries',
  staticFields: [
    'id',
    'kind',
    'eventType',
    'notificationChannelId',
    'notificationChannelName',
    'notificationChannelType',
    'repositoryId',
    'repositoryOwner',
    'repositoryName',
    'subjectKind',
    'subjectTitle',
    'subjectUrl',
    'attempts',
    'status',
    'finalError',
  ],
});
const {
  columnOrder,
  columnVisibility,
  columns,
  error: tableError,
  filtering,
  items,
  itemsPerPage,
  loading,
  page,
  sorting,
  totalItems,
} = deliveryTable;
const columnPinning = computed({
  get: () => ({ left: deliveryTable.columnPinning.value.left, right: deliveryTable.columnPinning.value.right }),
  set: (value: { left?: string[]; right?: string[] }) => {
    deliveryTable.columnPinning.value = value;
  },
});
function statusColor(status: NotificationDeliveryStatus): 'info' | 'success' | 'error' {
  return status === 'DELIVERED' ? 'success' : status === 'FAILED' ? 'error' : 'info';
}
function openDetails(delivery: NotificationDelivery): void {
  selectedDelivery.value = delivery;
  detailsOpen.value = true;
}
onMounted(() => void deliveryTable.initialize());
</script>
