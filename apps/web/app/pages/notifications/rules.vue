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
      <UButton
        v-if="manageableRepositories.length > 0"
        icon="i-lucide-plus"
        :label="$t('notifications.rulesView.add')"
        @click="openCreate"
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
      :empty="$t('notifications.rulesView.empty')"
      :loading="loading"
      :ui="{ th: 'first:pl-8 bg-neutral-100 dark:bg-neutral-950/20', td: 'first:pl-8' }"
    >
      <template #repositoryName-cell="{ row }">
        <span class="font-medium">{{ row.original.repositoryOwner }}/{{ row.original.repositoryName }}</span>
      </template>
      <template #workflowPattern-cell="{ row }">
        <code>{{ row.original.workflowPattern }}</code>
      </template>
      <template #outcome-cell="{ row }">
        <UBadge variant="subtle" :color="row.original.outcome === 'FAILED' ? 'error' : 'success'">
          {{ $t(`workflowStatus.${row.original.outcome}`) }}
        </UBadge>
      </template>
      <template #channels-cell="{ row }">
        <div class="flex flex-wrap gap-1">
          <UBadge v-for="channel in row.original.channels" :key="channel.id" color="neutral" variant="outline">
            {{ channel.name }}
          </UBadge>
        </div>
      </template>
      <template #enabled-cell="{ row }">
        <UBadge variant="subtle" :color="row.original.enabled ? 'success' : 'neutral'">
          {{ row.original.enabled ? $t('notifications.enabled') : $t('notifications.disabled') }}
        </UBadge>
      </template>
      <template #actions-header="{ column }">
        <span class="flex justify-end">{{ column.columnDef.header }}</span>
      </template>
      <template #actions-cell="{ row }">
        <div v-if="row.original.canManage" class="flex justify-end gap-1">
          <UButton
            color="neutral"
            icon="i-lucide-pencil"
            variant="ghost"
            :aria-label="$t('notifications.rulesView.edit')"
            @click="openEdit(row.original)"
          />
          <UButton
            color="neutral"
            variant="ghost"
            :aria-label="
              row.original.enabled ? $t('notifications.rulesView.disable') : $t('notifications.rulesView.enable')
            "
            :icon="row.original.enabled ? 'i-lucide-pause' : 'i-lucide-play'"
            :loading="isPending(`toggle:${row.original.id}`)"
            @click="toggle(row.original)"
          />
          <UButton
            color="error"
            icon="i-lucide-trash-2"
            variant="ghost"
            :aria-label="$t('notifications.rulesView.delete')"
            :loading="isPending(`delete:${row.original.id}`)"
            @click="remove(row.original.id)"
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
    <ModulesNotificationsRuleDialog
      v-model:open="dialogOpen"
      :repositories="manageableRepositories"
      :rule="selectedRule"
      @saved="handleSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { FilterFieldType, type FilterField, type SortingField } from '@querry-kit/nuxt-ui/types';
import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import { useTable } from '~/composables/api/table';
import { usePendingActions } from '~/composables/use-pending-actions';
import type { NotificationRule } from '~/types/api/resources';
import type { ColumnDefinition } from '~/types/table';

type RuleRow = NotificationRule & Record<string, unknown>;
type RuleColumn = ColumnDefinition<RuleRow> & { header: string; id: string };
const { t } = useI18n();
const api = useEzRepoApi();
const { isPending, run: runPendingAction } = usePendingActions();
const dialogOpen = ref(false);
const selectedRule = ref<NotificationRule | null>(null);
const manageableRepositories = ref<Array<{ id: string; name: string; owner: string }>>([]);
const columnDefinition = computed<RuleColumn[]>(() => [
  { accessorKey: 'repositoryName', header: t('notifications.columns.repository'), id: 'repositoryName' },
  { accessorKey: 'workflowPattern', header: t('notifications.columns.workflow'), id: 'workflowPattern' },
  { accessorKey: 'outcome', header: t('notifications.columns.event'), id: 'outcome' },
  { header: t('notifications.columns.channels'), id: 'channels' },
  { accessorKey: 'enabled', header: t('notifications.columns.status'), id: 'enabled' },
  { enableHiding: false, header: t('notifications.columns.actions'), id: 'actions' },
]);
const sortableFields = computed<SortingField[]>(() => [
  { label: t('notifications.columns.workflow'), value: 'workflowPattern' },
  { label: t('notifications.columns.event'), value: 'outcome' },
  { label: t('notifications.columns.status'), value: 'enabled' },
]);
const filterFields = computed<FilterField[]>(() => [
  {
    label: t('notifications.columns.event'),
    type: FilterFieldType.Enum,
    value: 'outcome',
    values: ['SUCCESS', 'FAILED'].map((value) => ({ label: t(`workflowStatus.${value}`), value })),
  },
  { label: t('notifications.columns.status'), type: FilterFieldType.Boolean, value: 'enabled' },
]);
const ruleTable = useTable({
  columnDefinition,
  defaultItemsPerPage: 10,
  endpoint: 'notification-rules/query',
  name: 'notification-rules',
  staticFields: [
    'id',
    'repositoryId',
    'repositoryOwner',
    'repositoryName',
    'channelIds',
    'channels',
    'enabled',
    'canManage',
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
} = ruleTable;
const columnPinning = computed({
  get: () => ({ left: ruleTable.columnPinning.value.left, right: ruleTable.columnPinning.value.right }),
  set: (value: { left?: string[]; right?: string[] }) => {
    ruleTable.columnPinning.value = value;
  },
});

function openCreate(): void {
  selectedRule.value = null;
  dialogOpen.value = true;
}
function openEdit(rule: NotificationRule): void {
  selectedRule.value = rule;
  dialogOpen.value = true;
}
async function handleSaved(): Promise<void> {
  await ruleTable.refresh();
}
async function toggle(rule: NotificationRule): Promise<void> {
  await runPendingAction(`toggle:${rule.id}`, async () => {
    await api.notificationRules.update(rule.id, { enabled: !rule.enabled });
    await ruleTable.refresh();
  });
}
async function remove(id: string): Promise<void> {
  await runPendingAction(`delete:${id}`, async () => {
    await api.notificationRules.delete(id);
    await ruleTable.refresh();
  });
}
onMounted(async () => {
  await Promise.all([
    ruleTable.initialize(),
    api.notificationChannels.manageableRepositories().then(({ data }) => {
      manageableRepositories.value = data;
    }),
  ]);
});
</script>
