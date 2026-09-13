<template>
  <LayoutPage
    :breadcrumbs="[
      { icon: 'i-lucide-layout-dashboard', label: $t('layout.dashboard'), to: '/' },
      { icon: 'i-lucide-git-branch', label: $t('layout.repositories') },
    ]"
    :description="$t('repositories.description')"
    :padded="false"
    :title="$t('repositories.title')"
  >
    <template #actions>
      <QTableSorting v-model:sorting="sorting" :fields="sortableFields" shortcuts />
      <QTableFiltering v-model:filtering="filtering" :fields="filterFields" shortcuts />
      <QTableOptions
        v-model:column-order="columnOrder"
        v-model:column-pinning="columnPinning"
        v-model:invisible-columns="columnVisibility"
        :columns="columnDefinition"
        shortcuts
      />
      <UButton v-if="isAdmin" icon="i-lucide-plus" :aria-label="$t('repositories.add')" @click="openAddDialog">
        <span class="hidden sm:inline">{{ $t('repositories.add') }}</span>
      </UButton>
    </template>

    <UAlert
      v-if="tableError"
      class="m-4"
      color="error"
      icon="i-lucide-circle-alert"
      variant="subtle"
      :title="$t('repositories.loadError')"
    />
    <UTable
      sticky
      v-model:column-pinning="columnPinning"
      class="min-h-0 flex-1"
      :columns="columns"
      :data="items"
      :empty="$t('repositories.empty')"
      :loading="loading"
      :ui="{
        th: 'first:pl-8 bg-neutral-100 dark:bg-neutral-950/20',
        td: 'first:pl-8',
      }"
    >
      <template #name-cell="{ row }">
        <span class="font-medium">{{ row.original.name }}</span>
      </template>
      <template #enabled-cell="{ row }">
        <UBadge variant="subtle" :color="row.original.enabled ? 'success' : 'neutral'">
          {{ row.original.enabled ? $t('repositories.enabled') : $t('repositories.disabled') }}
        </UBadge>
      </template>
      <template #id-cell="{ row }">
        <USkeleton v-if="webhookConfigurationsLoading" class="h-5 w-24" />
        <UBadge
          v-else-if="!webhookConfigurationsError"
          variant="subtle"
          :color="webhookConfiguration(row.original.id)?.configured ? 'success' : 'warning'"
        >
          {{
            $t(
              webhookConfiguration(row.original.id)?.configured
                ? 'repositories.webhook.configured'
                : 'repositories.webhook.notConfigured',
            )
          }}
        </UBadge>
        <UBadge v-else color="neutral" variant="subtle">{{ $t('repositories.webhook.unavailable') }}</UBadge>
      </template>
      <template #members-cell="{ row }">
        <UAvatarGroup size="sm" :max="5">
          <UTooltip v-for="member in row.original.members" :key="member.userId" :text="getUserIdentityLabel(member)">
            <CommonUserAvatar
              size="sm"
              :avatar-updated-at="member.avatarUpdatedAt"
              :first-name="member.firstName"
              :last-name="member.lastName"
              :user-id="member.userId"
              :username="member.username"
            />
          </UTooltip>
        </UAvatarGroup>
      </template>
      <template #workflowRunRetentionDays-cell="{ row }">
        <span class="text-sm text-muted">
          {{ row.original.workflowRunRetentionDays ?? $t('repositories.default') }}
        </span>
      </template>
      <template #workflowRunCount-cell="{ row }">
        <span class="tabular-nums">{{ row.original.workflowRunCount ?? 0 }}</span>
      </template>
      <template #lastSyncAt-cell="{ row }">
        <span class="whitespace-nowrap text-sm text-muted">{{ formatLastSync(row.original.lastSyncAt) }}</span>
      </template>
      <template #actions-header="{ column }">
        <span class="flex justify-end">{{ column.columnDef.header }}</span>
      </template>
      <template #actions-cell="{ row }">
        <div class="flex justify-end gap-1">
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
          <UTooltip :text="isAdmin ? $t('repositoryDetails.edit') : $t('repositoryDetails.open')">
            <UButton
              color="neutral"
              icon="i-lucide-settings-2"
              variant="ghost"
              :aria-label="isAdmin ? $t('repositoryDetails.edit') : $t('repositoryDetails.open')"
              @click="openDetailsDialog(row.original.id)"
            />
          </UTooltip>
          <UTooltip
            v-if="isAdmin"
            :text="row.original.enabled ? $t('repositories.disable') : $t('repositories.enable')"
          >
            <span class="inline-flex">
              <UButton
                color="neutral"
                variant="ghost"
                :aria-label="row.original.enabled ? $t('repositories.disable') : $t('repositories.enable')"
                :disabled="isPending(row.original.id)"
                :icon="row.original.enabled ? 'i-lucide-pause' : 'i-lucide-play'"
                :loading="isPending(row.original.id)"
                @click="toggle(row.original)"
              />
            </span>
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
    <ModulesRepositoriesAddDialog v-if="isAdmin" v-model:open="dialogOpen" @created="handleRepositoryCreated" />
    <ModulesRepositoriesDetailsDialog
      v-model:open="detailsDialogOpen"
      :repository-id="selectedRepositoryId"
      :webhook-configuration="selectedRepositoryWebhookConfiguration"
      :webhook-configuration-error="webhookConfigurationsError"
      :webhook-configuration-loading="webhookConfigurationsLoading"
      @updated="handleRepositoryUpdated"
      @webhook-updated="handleWebhookUpdated"
    />
  </LayoutPage>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import { FilterFieldType, type FilterField, type SortingField } from '@querry-kit/nuxt-ui/types';
import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import { useTable } from '~/composables/api/table';
import { useDateTime } from '~/composables/use-date-time';
import { usePendingActions } from '~/composables/use-pending-actions';
import { useAuthStore } from '~/store/auth';
import type { Repository, RepositoryWebhookConfiguration } from '~/types/api/resources';
import type { ColumnDefinition } from '~/types/table';
import { getUserIdentityLabel } from '~/utils/user-identity';

type RepositoryRow = Repository & Record<string, unknown>;
type RepositoryTableColumn = ColumnDefinition<RepositoryRow> & { header: string; id: string };

definePageMeta({ fullWidth: true });

const { t } = useI18n();
const { formatDateTime } = useDateTime();
const api = useEzRepoApi();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const isAdmin = computed(() => auth.user?.role === 'SYSTEM_ADMIN');
const dialogOpen = ref(false);
const webhookConfigurations = ref<RepositoryWebhookConfiguration[]>([]);
const webhookConfigurationsLoading = ref(false);
const webhookConfigurationsError = ref(false);
const openedFromList = ref(false);
const selectedRepositoryId = computed(() =>
  typeof route.query.repository === 'string' && route.query.repository ? route.query.repository : undefined,
);
const selectedRepositoryWebhookConfiguration = computed(() =>
  selectedRepositoryId.value ? webhookConfiguration(selectedRepositoryId.value) : undefined,
);
const detailsDialogOpen = computed({
  get: () => Boolean(selectedRepositoryId.value),
  set: (isOpen: boolean) => {
    if (!isOpen) closeDetailsDialog();
  },
});
const { isPending, run: runPendingAction } = usePendingActions();
const columnDefinition = computed<RepositoryTableColumn[]>(() => {
  const columns: RepositoryTableColumn[] = [
    { accessorKey: 'owner', header: t('repositories.columns.owner'), id: 'owner' },
    { accessorKey: 'name', header: t('repositories.columns.name'), id: 'name' },
    { accessorKey: 'enabled', header: t('repositories.columns.status'), id: 'enabled' },
    { accessorKey: 'members', header: t('repositories.columns.members'), id: 'members' },
    { accessorKey: 'workflowRunCount', header: t('repositories.columns.workflowRuns'), id: 'workflowRunCount' },
    {
      accessorKey: 'workflowRunRetentionDays',
      header: t('repositories.columns.retention'),
      id: 'workflowRunRetentionDays',
    },
    { accessorKey: 'lastSyncAt', header: t('repositories.columns.lastSync'), id: 'lastSyncAt' },
  ];
  // The status is loaded separately; reusing the already-required `id` field keeps it out of the resource projection.
  if (isAdmin.value) columns.push({ header: t('repositories.columns.webhook'), id: 'id' });
  columns.push({ enableHiding: false, header: t('repositories.columns.actions'), id: 'actions' });
  return columns;
});
const sortableFields = computed<SortingField[]>(() => [
  { label: t('repositories.columns.owner'), value: 'owner' },
  { label: t('repositories.columns.name'), value: 'name' },
  { label: t('repositories.columns.status'), value: 'enabled' },
  { label: t('repositories.columns.retention'), value: 'workflowRunRetentionDays' },
  { label: t('repositories.columns.lastSync'), value: 'lastSyncAt' },
]);
const filterFields = computed<FilterField[]>(() => [
  { label: t('repositories.columns.status'), type: FilterFieldType.Boolean, value: 'enabled' },
]);
const repositoryTable = useTable({
  columnDefinition,
  defaultItemsPerPage: 10,
  endpoint: 'repositories',
  name: 'repositories',
  staticFields: ['id', 'enabled', 'url', 'workflowRunRetentionDays'],
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
} = repositoryTable;
const columnPinning = computed({
  get: () => ({ left: repositoryTable.columnPinning.value.left, right: repositoryTable.columnPinning.value.right }),
  set: (value: { left?: string[]; right?: string[] }) => {
    repositoryTable.columnPinning.value = value;
  },
});

useHead({ title: computed(() => t('repositories.title')) });

watch(selectedRepositoryId, (repositoryId) => {
  if (!repositoryId) openedFromList.value = false;
});

/** Format a repository's last successful synchronization in the active interface locale. */
function formatLastSync(lastSyncAt: string | null): string {
  if (!lastSyncAt) return t('repositories.neverSynced');
  return formatDateTime(lastSyncAt);
}

/** Resolve safe webhook metadata for one repository. */
function webhookConfiguration(repositoryId: string): RepositoryWebhookConfiguration | undefined {
  return webhookConfigurations.value.find((configuration) => configuration.repositoryId === repositoryId);
}

/** Load repository webhook states only for system administrators. */
async function loadWebhookConfigurations(): Promise<void> {
  if (!isAdmin.value) return;
  webhookConfigurationsLoading.value = true;
  webhookConfigurationsError.value = false;
  try {
    webhookConfigurations.value = (await api.repositories.webhookConfigurations()).data;
  } catch {
    webhookConfigurations.value = [];
    webhookConfigurationsError.value = true;
  } finally {
    webhookConfigurationsLoading.value = false;
  }
}

/** Open the dialog used to discover a provider-owned repository. */
function openAddDialog(): void {
  dialogOpen.value = true;
}

/** Open a repository dialog while adding a browser-history entry. */
async function openDetailsDialog(repositoryId: string): Promise<void> {
  openedFromList.value = true;
  await router.push({ hash: route.hash, query: { ...route.query, repository: repositoryId } });
}

/** Close a repository dialog without discarding unrelated URL state. */
function closeDetailsDialog(): void {
  if (openedFromList.value) {
    openedFromList.value = false;
    router.back();
    return;
  }

  const query = { ...route.query };
  delete query.repository;
  void router.replace({ hash: route.hash, query });
}

defineShortcuts({
  shift_n: () => {
    if (isAdmin.value) openAddDialog();
  },
});

/** Refresh the list from its first page after the dialog adds a repository. */
async function handleRepositoryCreated(): Promise<void> {
  page.value = 1;
  await Promise.all([repositoryTable.refresh(), loadWebhookConfigurations()]);
}

/** Replace a changed repository row without reloading the complete table. */
function handleRepositoryUpdated(repository: Repository): void {
  const existingRepository = items.value.find((item) => item.id === repository.id);
  repositoryTable.updateRow({ ...existingRepository, ...repository } as RepositoryRow);
}

/** Replace webhook metadata changed in the repository detail card. */
function handleWebhookUpdated(configuration: RepositoryWebhookConfiguration): void {
  webhookConfigurations.value = [
    ...webhookConfigurations.value.filter((item) => item.repositoryId !== configuration.repositoryId),
    configuration,
  ];
}

/** Enable or disable a repository without changing its retention configuration. */
async function toggle(repository: Repository): Promise<void> {
  await runPendingAction(repository.id, async () => {
    await api.repositories.update(repository.id, {
      enabled: !repository.enabled,
      workflowRunRetentionDays: repository.workflowRunRetentionDays,
    });
    repositoryTable.updateRow({ ...repository, enabled: !repository.enabled } as RepositoryRow);
  });
}

onMounted(() => void Promise.all([repositoryTable.initialize(), loadWebhookConfigurations()]));
</script>
