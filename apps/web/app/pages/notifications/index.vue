<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="border-b border-default p-4 sm:px-6">
      <UAlert
        v-if="push.error.value"
        class="mb-4"
        color="error"
        icon="i-lucide-circle-alert"
        variant="subtle"
        :title="$t('notifications.push.error')"
      />
      <UCard :ui="{ body: 'flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between' }">
        <div class="flex min-w-0 items-start gap-3">
          <UIcon class="mt-0.5 size-6 shrink-0 text-primary" name="i-lucide-monitor-smartphone" />
          <div>
            <p class="font-semibold">{{ $t('notifications.push.title') }}</p>
            <p class="text-sm text-muted">
              {{
                $t('notifications.push.description', {
                  count: push.subscriptionCount.value,
                })
              }}
            </p>
          </div>
        </div>
        <UButton
          color="neutral"
          :disabled="!push.supported.value || !push.available.value"
          :icon="push.currentDeviceEnabled.value ? 'i-lucide-bell-off' : 'i-lucide-bell-ring'"
          :label="
            !push.available.value
              ? $t('notifications.push.unavailable')
              : push.currentDeviceEnabled.value
                ? $t('notifications.push.disable')
                : $t('notifications.push.enable')
          "
          :loading="push.loading.value"
          @click="push.currentDeviceEnabled.value ? push.disable() : push.enable()"
        />
      </UCard>
    </div>

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
        :label="$t('notifications.channels.add')"
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
      :empty="$t('notifications.channels.empty')"
      :loading="loading"
      :ui="{ th: 'first:pl-8 bg-neutral-100 dark:bg-neutral-950/20', td: 'first:pl-8' }"
    >
      <template #repositoryName-cell="{ row }">
        <span class="font-medium">{{ row.original.repositoryOwner }}/{{ row.original.repositoryName }}</span>
      </template>
      <template #type-cell="{ row }">
        <UBadge color="neutral" variant="subtle">{{ typeLabel(row.original.type) }}</UBadge>
      </template>
      <template #target-cell="{ row }">
        <span class="text-sm text-muted">
          {{
            row.original.browserRecipientUsername ? `@${row.original.browserRecipientUsername}` : row.original.urlScheme
          }}
        </span>
      </template>
      <template #enabled-cell="{ row }">
        <UBadge variant="subtle" :color="row.original.enabled ? 'success' : 'neutral'">
          {{ row.original.enabled ? $t('notifications.enabled') : $t('notifications.disabled') }}
        </UBadge>
      </template>
      <template #updatedAt-cell="{ row }">
        <span class="whitespace-nowrap text-sm text-muted">{{ formatDateTime(row.original.updatedAt) }}</span>
      </template>
      <template #actions-header="{ column }">
        <span class="flex justify-end">{{ column.columnDef.header }}</span>
      </template>
      <template #actions-cell="{ row }">
        <div v-if="row.original.canManage" class="flex justify-end gap-1">
          <UButton
            color="neutral"
            icon="i-lucide-send"
            variant="ghost"
            :aria-label="$t('notifications.channels.test')"
            :disabled="isPending(row.original.id) || !canTest(row.original)"
            :loading="isPending(`test:${row.original.id}`)"
            @click="testChannel(row.original)"
          />
          <UButton
            color="neutral"
            icon="i-lucide-pencil"
            variant="ghost"
            :aria-label="$t('notifications.channels.edit')"
            :disabled="isPending(row.original.id)"
            @click="openEdit(row.original)"
          />
          <UButton
            color="neutral"
            variant="ghost"
            :aria-label="
              row.original.enabled ? $t('notifications.channels.disable') : $t('notifications.channels.enable')
            "
            :icon="row.original.enabled ? 'i-lucide-pause' : 'i-lucide-play'"
            :loading="isPending(`toggle:${row.original.id}`)"
            @click="toggle(row.original)"
          />
          <UButton
            color="error"
            icon="i-lucide-trash-2"
            variant="ghost"
            :aria-label="$t('notifications.channels.delete')"
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

    <ModulesNotificationsChannelDialog
      v-model:open="dialogOpen"
      :channel="selectedChannel"
      :browser-push-available="push.available.value"
      :repositories="manageableRepositories"
      @saved="handleSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { FilterFieldType, type FilterField, type SortingField } from '@querry-kit/nuxt-ui/types';
import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import { useTable } from '~/composables/api/table';
import { useBrowserPush } from '~/composables/app/browser-push';
import { useDateTime } from '~/composables/use-date-time';
import { usePendingActions } from '~/composables/use-pending-actions';
import { useAuthStore } from '~/store/auth';
import type { NotificationChannel, NotificationChannelType } from '~/types/api/resources';
import type { ColumnDefinition } from '~/types/table';

type ChannelRow = NotificationChannel & Record<string, unknown>;
type ChannelColumn = ColumnDefinition<ChannelRow> & { header: string; id: string };

const { t } = useI18n();
const toast = useToast();
const api = useEzRepoApi();
const auth = useAuthStore();
const push = useBrowserPush();
const { formatDateTime } = useDateTime();
const { isPending, run: runPendingAction } = usePendingActions();
const dialogOpen = ref(false);
const selectedChannel = ref<NotificationChannel | null>(null);
const manageableRepositories = ref<Array<{ id: string; name: string; owner: string }>>([]);
const channelTypes: NotificationChannelType[] = [
  'EMAIL',
  'GOTIFY',
  'NTFY',
  'DISCORD',
  'CUSTOM_APPRISE',
  'BROWSER_PUSH',
];
const columnDefinition = computed<ChannelColumn[]>(() => [
  { accessorKey: 'repositoryName', header: t('notifications.columns.repository'), id: 'repositoryName' },
  { accessorKey: 'name', header: t('notifications.columns.name'), id: 'name' },
  { accessorKey: 'type', header: t('notifications.columns.type'), id: 'type' },
  { header: t('notifications.columns.target'), id: 'target' },
  { accessorKey: 'enabled', header: t('notifications.columns.status'), id: 'enabled' },
  { accessorKey: 'updatedAt', header: t('notifications.columns.updatedAt'), id: 'updatedAt' },
  { enableHiding: false, header: t('notifications.columns.actions'), id: 'actions' },
]);
const sortableFields = computed<SortingField[]>(() => [
  { label: t('notifications.columns.name'), value: 'name' },
  { label: t('notifications.columns.type'), value: 'type' },
  { label: t('notifications.columns.status'), value: 'enabled' },
  { label: t('notifications.columns.updatedAt'), value: 'updatedAt' },
]);
const filterFields = computed<FilterField[]>(() => [
  {
    label: t('notifications.columns.type'),
    type: FilterFieldType.Enum,
    value: 'type',
    values: channelTypes.map((value) => ({ label: typeLabel(value), value })),
  },
  { label: t('notifications.columns.status'), type: FilterFieldType.Boolean, value: 'enabled' },
]);
const channelTable = useTable({
  columnDefinition,
  defaultItemsPerPage: 10,
  endpoint: 'notification-channels/query',
  name: 'notification-channels',
  staticFields: [
    'id',
    'repositoryId',
    'repositoryOwner',
    'repositoryName',
    'type',
    'urlScheme',
    'browserRecipientUserId',
    'browserRecipientUsername',
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
} = channelTable;
const columnPinning = computed({
  get: () => ({ left: channelTable.columnPinning.value.left, right: channelTable.columnPinning.value.right }),
  set: (value: { left?: string[]; right?: string[] }) => {
    channelTable.columnPinning.value = value;
  },
});

function typeLabel(type: NotificationChannelType): string {
  return t(`notifications.channelTypes.${type}`);
}

function canTest(channel: NotificationChannel): boolean {
  return channel.type !== 'BROWSER_PUSH' || channel.browserRecipientUserId === auth.user?.id;
}

function openCreate(): void {
  selectedChannel.value = null;
  dialogOpen.value = true;
}

function openEdit(channel: NotificationChannel): void {
  selectedChannel.value = channel;
  dialogOpen.value = true;
}

async function handleSaved(): Promise<void> {
  await channelTable.refresh();
}

async function toggle(channel: NotificationChannel): Promise<void> {
  await runPendingAction(`toggle:${channel.id}`, async () => {
    await api.notificationChannels.update(channel.id, { enabled: !channel.enabled });
    await channelTable.refresh();
  });
}

async function remove(id: string): Promise<void> {
  await runPendingAction(`delete:${id}`, async () => {
    await api.notificationChannels.delete(id);
    await channelTable.refresh();
  });
}

async function testChannel(channel: NotificationChannel): Promise<void> {
  await runPendingAction(`test:${channel.id}`, async () => {
    const { data } = await api.notificationChannels.test(channel.id);
    toast.add({
      color: data.status === 'DELIVERED' ? 'success' : 'error',
      title: t(
        data.status === 'DELIVERED' ? 'notifications.channels.testSuccess' : 'notifications.channels.testFailure',
      ),
    });
  });
}

onMounted(async () => {
  await Promise.all([
    channelTable.initialize(),
    push.refresh(),
    api.notificationChannels.manageableRepositories().then(({ data }) => {
      manageableRepositories.value = data;
    }),
  ]);
});
</script>
