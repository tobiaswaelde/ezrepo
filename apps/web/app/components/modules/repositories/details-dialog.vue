<template>
  <UModal
    v-model:open="open"
    :description="$t('repositoryDetails.generalDescription')"
    :dismissible="!refreshing && !syncing"
    :title="dialogTitle"
    :ui="{ body: 'max-h-[min(75vh,48rem)] overflow-y-auto', content: 'sm:max-w-5xl' }"
  >
    <template #body>
      <UAlert
        v-if="loadError"
        color="error"
        icon="i-lucide-circle-alert"
        variant="subtle"
        :title="$t('repositoryDetails.loadError')"
      />

      <div v-else-if="loading" class="space-y-4">
        <USkeleton class="h-36 w-full" />
        <div v-if="isAdmin" class="grid gap-4 lg:grid-cols-2">
          <USkeleton class="h-72 w-full" />
          <USkeleton class="h-72 w-full" />
        </div>
      </div>

      <div v-else-if="repository" class="space-y-4">
        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            v-if="isAdmin"
            color="neutral"
            icon="i-lucide-refresh-cw"
            variant="soft"
            :label="$t('repositoryDetails.refresh')"
            :loading="refreshing"
            @click="refreshRepository"
          />
          <UButton
            v-if="isAdmin"
            color="primary"
            icon="i-lucide-download"
            :label="$t('repositoryDetails.syncWorkflowRuns')"
            :loading="syncing"
            @click="syncWorkflowRuns"
          />
          <UButton
            color="neutral"
            icon="i-tabler-external-link"
            rel="noreferrer"
            target="_blank"
            variant="soft"
            :label="$t('dashboard.openProvider')"
            :to="repository.url"
          />
        </div>

        <ModulesRepositoriesDetailsGeneralCard
          :editable="isAdmin"
          :repository="repository"
          @updated="handleRepositoryUpdated"
        />
        <ModulesRepositoriesDetailsWebhookCard
          v-if="isAdmin"
          :configuration="webhookConfiguration"
          :load-error="webhookConfigurationError"
          :loading="webhookConfigurationLoading"
          :repository-id="repository.id"
          @updated="emit('webhookUpdated', $event)"
        />
        <div v-if="isAdmin" class="grid gap-4 lg:grid-cols-2">
          <ModulesRepositoriesDetailsWorkflowFiltersCard :repository-id="repository.id" />
          <ModulesRepositoriesDetailsMembersCard :repository-id="repository.id" />
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import { useAuthStore } from '~/store/auth';
import type { Repository, RepositoryWebhookConfiguration } from '~/types/api/resources';

const props = defineProps<{
  repositoryId?: string;
  webhookConfiguration?: RepositoryWebhookConfiguration;
  webhookConfigurationError: boolean;
  webhookConfigurationLoading: boolean;
}>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{
  updated: [repository: Repository];
  webhookUpdated: [configuration: RepositoryWebhookConfiguration];
}>();

const api = useEzRepoApi();
const auth = useAuthStore();
const { t } = useI18n();
const repository = ref<Repository>();
const loading = ref(false);
const loadError = ref(false);
const refreshing = ref(false);
const syncing = ref(false);
const toast = useToast();
const isAdmin = computed(() => auth.user?.role === 'SYSTEM_ADMIN');
const dialogTitle = computed(() =>
  repository.value ? `${repository.value.owner}/${repository.value.name}` : t('repositoryDetails.title'),
);

watch(
  [open, () => props.repositoryId],
  ([isOpen, repositoryId]) => {
    if (isOpen && repositoryId) void load(repositoryId);
    if (!isOpen) reset();
  },
  { immediate: true },
);

/** Clear repository-specific state when the dialog closes. */
function reset(): void {
  repository.value = undefined;
  loadError.value = false;
  loading.value = false;
  refreshing.value = false;
  syncing.value = false;
}

/** Load the repository selected by the URL-controlled dialog. */
async function load(repositoryId: string): Promise<void> {
  loading.value = true;
  loadError.value = false;
  repository.value = undefined;
  try {
    const { data } = await api.repositories.get(repositoryId);
    if (open.value && props.repositoryId === repositoryId) repository.value = data;
  } catch {
    if (open.value && props.repositoryId === repositoryId) loadError.value = true;
  } finally {
    if (props.repositoryId === repositoryId) loading.value = false;
  }
}

/** Propagate a saved repository to the list while retaining it in the dialog. */
function handleRepositoryUpdated(updatedRepository: Repository): void {
  repository.value = updatedRepository;
  emit('updated', updatedRepository);
}

/** Refresh provider-owned metadata for the displayed repository. */
async function refreshRepository(): Promise<void> {
  if (!repository.value || refreshing.value) return;
  refreshing.value = true;
  try {
    const { data } = await api.repositories.refresh(repository.value.id);
    handleRepositoryUpdated(data);
    toast.add({ color: 'success', title: t('repositoryDetails.refreshSuccess') });
  } catch {
    toast.add({ color: 'error', title: t('repositoryDetails.refreshError') });
  } finally {
    refreshing.value = false;
  }
}

/** Queue an immediate read-only workflow synchronization for the displayed repository. */
async function syncWorkflowRuns(): Promise<void> {
  if (!repository.value || syncing.value) return;
  syncing.value = true;
  try {
    await api.repositories.sync(repository.value.id);
    toast.add({ color: 'success', title: t('repositoryDetails.syncWorkflowRunsQueued') });
  } catch {
    toast.add({ color: 'error', title: t('repositoryDetails.syncWorkflowRunsError') });
  } finally {
    syncing.value = false;
  }
}
</script>
