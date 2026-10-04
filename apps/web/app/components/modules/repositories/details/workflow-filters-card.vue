<template>
  <UCard :ui="{ body: 'space-y-4' }">
    <template #header>
      <div>
        <h2 class="font-semibold">{{ $t('repositoryDetails.workflowFilters') }}</h2>
        <p class="text-sm text-muted">{{ $t('repositoryDetails.workflowFiltersDescription') }}</p>
      </div>
    </template>

    <UAlert
      v-if="error"
      color="error"
      icon="i-lucide-circle-alert"
      variant="subtle"
      :title="$t('repositoryDetails.saveError')"
    />
    <div class="flex flex-col gap-2 sm:flex-row">
      <USelect v-model="form.mode" class="sm:w-36" :items="filterModeOptions" />
      <UInput v-model="form.pattern" class="flex-1" :placeholder="$t('repositoryDetails.filterPlaceholder')" />
      <UButton
        icon="i-lucide-plus"
        :aria-label="$t('repositoryDetails.addFilter')"
        :disabled="!form.pattern.trim()"
        :loading="adding"
        @click="addWorkflowFilter"
      />
    </div>

    <UTable
      sticky
      :column-pinning="{ right: ['actions'] }"
      :columns="columns"
      :data="filters"
      :empty="$t('repositoryDetails.noWorkflowFilters')"
      :loading="loading"
    >
      <template #mode-cell="{ row }">
        <UBadge variant="subtle" :color="row.original.mode === 'DENY' ? 'error' : 'success'">
          {{ row.original.mode === 'DENY' ? $t('repositoryDetails.deny') : $t('repositoryDetails.allow') }}
        </UBadge>
      </template>
      <template #actions-header="{ column }">
        <span class="flex justify-end">{{ column.columnDef.header }}</span>
      </template>
      <template #actions-cell="{ row }">
        <div class="flex justify-end">
          <UTooltip :portal="false" :text="$t('repositoryDetails.delete')">
            <span class="inline-flex">
              <UButton
                color="error"
                icon="i-lucide-trash-2"
                variant="ghost"
                :aria-label="$t('repositoryDetails.delete')"
                :disabled="isPending(row.original.id)"
                :loading="isPending(row.original.id)"
                @click="removeWorkflowFilter(row.original.id)"
              />
            </span>
          </UTooltip>
        </div>
      </template>
    </UTable>
  </UCard>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';

import { defineProps } from 'vue';
import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import { usePendingActions } from '~/composables/use-pending-actions';
import type { WorkflowFilter } from '~/types/api/resources';

const props = defineProps<{
  repositoryId: string;
}>();

const { t } = useI18n();
const api = useEzRepoApi();
const { isPending, run: runPendingAction } = usePendingActions();
const filters = ref<WorkflowFilter[]>([]);
const loading = ref(true);
const adding = ref(false);
const error = ref(false);
const form = reactive<{ mode: WorkflowFilter['mode']; pattern: string }>({ mode: 'ALLOW', pattern: '' });
const filterModeOptions = computed(() => [
  { label: t('repositoryDetails.allow'), value: 'ALLOW' },
  { label: t('repositoryDetails.deny'), value: 'DENY' },
]);
const columns = computed(() => [
  { accessorKey: 'mode', header: t('repositoryDetails.mode') },
  { accessorKey: 'pattern', header: t('repositoryDetails.pattern') },
  { id: 'actions', header: t('repositoryDetails.actions') },
]);

/** Load filters attached to the displayed repository. */
async function load(): Promise<void> {
  loading.value = true;
  error.value = false;
  try {
    const { data } = await api.repositories.listWorkflowFilters(props.repositoryId);
    filters.value = data;
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
}

/** Validate and create a repository-scoped workflow filter. */
async function addWorkflowFilter(): Promise<void> {
  if (!form.pattern.trim()) return;

  adding.value = true;
  error.value = false;
  try {
    const { data } = await api.repositories.createWorkflowFilter(props.repositoryId, {
      mode: form.mode,
      pattern: form.pattern,
    });
    filters.value = [...filters.value, data].sort((left, right) => left.pattern.localeCompare(right.pattern));
    form.pattern = '';
  } catch {
    error.value = true;
  } finally {
    adding.value = false;
  }
}

/** Delete a workflow filter without reloading the unchanged table rows. */
async function removeWorkflowFilter(filterId: string): Promise<void> {
  await runPendingAction(filterId, async () => {
    error.value = false;
    try {
      await api.repositories.deleteWorkflowFilter(props.repositoryId, filterId);
      filters.value = filters.value.filter((filter) => filter.id !== filterId);
    } catch {
      error.value = true;
    }
  });
}

onMounted(() => void load());
</script>
