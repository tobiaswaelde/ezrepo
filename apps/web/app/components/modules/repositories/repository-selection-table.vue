<template>
  <div class="space-y-3">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <UInput
        v-model="search"
        class="w-full sm:max-w-sm"
        icon="i-lucide-search"
        type="search"
        :disabled="loading"
        :placeholder="$t('repositories.repositorySearchPlaceholder')"
      />
      <p class="shrink-0 text-sm text-muted" aria-live="polite">
        {{ $t('repositories.selectedCount', { count: selectedRepositoryIds.length }) }}
      </p>
    </div>
    <div class="max-h-80 overflow-auto rounded-md border border-default">
      <UTable
        sticky
        :columns="columns"
        :data="filteredRepositories"
        :empty="$t('repositories.noMatchingRepositories')"
        :loading="loading"
      >
        <template #select-header>
          <UCheckbox
            :aria-label="$t('repositories.selectAllRepositories')"
            :disabled="visibleSelectableRepositories.length === 0"
            :indeterminate="someVisibleRepositoriesSelected && !allVisibleRepositoriesSelected"
            :model-value="allVisibleRepositoriesSelected"
            @update:model-value="toggleVisibleRepositories($event === true)"
          />
        </template>
        <template #select-cell="{ row }">
          <UCheckbox
            :aria-label="
              $t('repositories.selectRepository', {
                repository: `${row.original.owner}/${row.original.name}`,
              })
            "
            :disabled="row.original.tracked"
            :model-value="selectedRepositoryIds.includes(row.original.providerRepositoryId)"
            @click.stop
            @update:model-value="setRepositorySelected(row.original.providerRepositoryId, $event === true)"
          />
        </template>
        <template #tracked-cell="{ row }">
          <UBadge variant="subtle" :color="row.original.tracked ? 'neutral' : 'success'">
            {{ row.original.tracked ? $t('repositories.alreadyTracked') : $t('repositories.available') }}
          </UBadge>
        </template>
      </UTable>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { TableColumn } from '#ui/types';
import { computed, ref } from 'vue';

import { defineModel, defineProps } from 'vue';
import type { ProviderRepository } from '~/types/api/resources';

const props = defineProps<{
  loading: boolean;
  repositories: ProviderRepository[];
}>();
const selectedRepositoryIds = defineModel<string[]>('selectedRepositoryIds', { required: true });
const { t } = useI18n();
const search = ref('');
const columns = computed<TableColumn<ProviderRepository>[]>(() => [
  { id: 'select' },
  { accessorKey: 'owner', header: t('repositories.columns.owner'), id: 'owner' },
  { accessorKey: 'name', header: t('repositories.columns.name'), id: 'name' },
  { accessorKey: 'tracked', header: t('repositories.columns.status'), id: 'tracked' },
]);
const filteredRepositories = computed(() => {
  const normalizedSearch = search.value.trim().toLocaleLowerCase();
  if (!normalizedSearch) return props.repositories;
  return props.repositories.filter((repository) =>
    [repository.owner, repository.name, repository.url].some((value) =>
      value.toLocaleLowerCase().includes(normalizedSearch),
    ),
  );
});
const visibleSelectableRepositories = computed(() =>
  filteredRepositories.value.filter((repository) => !repository.tracked),
);
const allVisibleRepositoriesSelected = computed(
  () =>
    visibleSelectableRepositories.value.length > 0 &&
    visibleSelectableRepositories.value.every((repository) =>
      selectedRepositoryIds.value.includes(repository.providerRepositoryId),
    ),
);
const someVisibleRepositoriesSelected = computed(() =>
  visibleSelectableRepositories.value.some((repository) =>
    selectedRepositoryIds.value.includes(repository.providerRepositoryId),
  ),
);

/** Select or deselect one available provider repository. */
function setRepositorySelected(providerRepositoryId: string, selected: boolean): void {
  const repository = props.repositories.find((item) => item.providerRepositoryId === providerRepositoryId);
  if (!repository || repository.tracked) return;

  selectedRepositoryIds.value = selected
    ? [...new Set([...selectedRepositoryIds.value, providerRepositoryId])]
    : selectedRepositoryIds.value.filter((id) => id !== providerRepositoryId);
}

/** Select or deselect every available repository visible through the current search. */
function toggleVisibleRepositories(selected: boolean): void {
  const visibleIds = new Set(visibleSelectableRepositories.value.map((repository) => repository.providerRepositoryId));
  selectedRepositoryIds.value = selected
    ? [...new Set([...selectedRepositoryIds.value, ...visibleIds])]
    : selectedRepositoryIds.value.filter((id) => !visibleIds.has(id));
}
</script>
