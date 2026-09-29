<template>
  <LayoutPage
    :breadcrumbs="[
      { icon: 'i-lucide-layout-dashboard', label: $t('layout.dashboard'), to: '/' },
      { icon: 'i-lucide-git-branch', label: $t('layout.repositories'), to: '/repositories' },
      { label: repositoryName },
    ]"
    :title="repositoryName"
  >
    <template #actions>
      <UButton
        v-if="isAdmin && repository"
        color="neutral"
        icon="i-lucide-refresh-cw"
        variant="soft"
        :label="$t('repositoryDetails.refresh')"
        :loading="refreshing"
        @click="refreshRepository"
      />
      <UButton
        v-if="isAdmin && repository"
        icon="i-lucide-download"
        :label="$t('repositoryDetails.syncWorkflowRuns')"
        :loading="syncing"
        @click="syncRepository"
      />
      <UButton
        v-if="repository"
        color="neutral"
        icon="i-tabler-external-link"
        rel="noreferrer"
        target="_blank"
        variant="soft"
        :label="$t('dashboard.openProvider')"
        :to="repository.url"
      />
    </template>

    <div v-if="loading" class="space-y-6">
      <USkeleton class="h-44 w-full" />
      <USkeleton class="h-48 w-full" />
      <div class="grid gap-6 xl:grid-cols-3">
        <USkeleton v-for="index in 3" :key="index" class="h-72 w-full" />
      </div>
    </div>
    <UAlert
      v-else-if="loadError"
      color="error"
      icon="i-lucide-circle-alert"
      variant="subtle"
      :title="$t(forbidden ? 'repositoryDetails.unauthorized' : 'repositoryDetails.loadError')"
    />
    <div v-else-if="repository" class="space-y-6">
      <ModulesRepositoriesDetailsGeneralCard
        :editable="isAdmin"
        :repository="repository"
        @updated="handleRepositoryUpdated"
      />
      <ModulesRepositoriesDetailsSyncStatusCard :repository="repository" />

      <div class="grid gap-6 xl:grid-cols-3">
        <ModulesRepositoriesDetailsActivitySection kind="workflowRuns" :repository-id="repository.id" />
        <ModulesRepositoriesDetailsActivitySection kind="issues" :repository-id="repository.id" />
        <ModulesRepositoriesDetailsActivitySection kind="pullRequests" :repository-id="repository.id" />
        <ModulesRepositoriesDetailsActivitySection
          v-if="canViewAlerts"
          kind="securityAlerts"
          :repository-id="repository.id"
        />
      </div>

      <section v-if="isAdmin" id="settings" class="space-y-4">
        <div>
          <h2 class="text-lg font-semibold">{{ $t('repositoryDetails.settings') }}</h2>
          <p class="text-sm text-muted">{{ $t('repositoryDetails.generalDescription') }}</p>
        </div>
        <ModulesRepositoriesDetailsWebhookCard
          :configuration="webhookConfiguration"
          :load-error="webhookConfigurationError"
          :loading="webhookConfigurationLoading"
          :repository-id="repository.id"
          @updated="webhookConfiguration = $event"
        />
        <div class="grid gap-6 lg:grid-cols-2">
          <ModulesRepositoriesDetailsWorkflowFiltersCard :repository-id="repository.id" />
          <ModulesRepositoriesDetailsMembersCard :repository-id="repository.id" />
        </div>
      </section>
    </div>
  </LayoutPage>
</template>

<script setup lang="ts">
import axios from 'axios';
import { computed, ref, watch } from 'vue';

import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import { useAuthStore } from '~/store/auth';
import type { Repository, RepositoryDetail, RepositoryWebhookConfiguration } from '~/types/api/resources';

definePageMeta({ fullWidth: true });

const route = useRoute();
const { t } = useI18n();
const api = useEzRepoApi();
const auth = useAuthStore();
const toast = useToast();
const repositoryId = computed(() => String(route.params.id));
const repository = ref<RepositoryDetail>();
const loading = ref(true);
const loadError = ref(false);
const forbidden = ref(false);
const refreshing = ref(false);
const syncing = ref(false);
const webhookConfiguration = ref<RepositoryWebhookConfiguration>();
const webhookConfigurationLoading = ref(false);
const webhookConfigurationError = ref(false);
const isAdmin = computed(() => auth.user?.role === 'SYSTEM_ADMIN');
const canViewAlerts = computed(() => ['MANAGER', 'SYSTEM_ADMIN'].includes(auth.user?.role ?? ''));
const repositoryName = computed(() =>
  repository.value ? `${repository.value.owner}/${repository.value.name}` : t('repositoryDetails.title'),
);

useHead({ title: repositoryName });

/** Load the permission-filtered repository and optional administrator metadata. */
async function load(id: string): Promise<void> {
  loading.value = true;
  loadError.value = false;
  forbidden.value = false;
  repository.value = undefined;
  webhookConfiguration.value = undefined;
  try {
    const detail = (await api.repositories.get(id)).data;
    if (repositoryId.value !== id) return;
    repository.value = detail;
    if (isAdmin.value) await loadWebhookConfiguration(id);
  } catch (error) {
    if (repositoryId.value === id) {
      forbidden.value = axios.isAxiosError(error) && (error.response?.status === 403 || error.response?.status === 404);
      loadError.value = true;
    }
  } finally {
    if (repositoryId.value === id) loading.value = false;
  }
}

/** Load safe webhook status separately so failures do not hide repository activity. */
async function loadWebhookConfiguration(id: string): Promise<void> {
  webhookConfigurationLoading.value = true;
  webhookConfigurationError.value = false;
  try {
    const { data } = await api.repositories.webhookConfigurations();
    if (repositoryId.value === id)
      webhookConfiguration.value = data.find((configuration) => configuration.repositoryId === id);
  } catch {
    if (repositoryId.value === id) webhookConfigurationError.value = true;
  } finally {
    if (repositoryId.value === id) webhookConfigurationLoading.value = false;
  }
}

/** Retain detail-only synchronization metadata after a repository settings update. */
function handleRepositoryUpdated(updatedRepository: Repository): void {
  if (repository.value) repository.value = { ...repository.value, ...updatedRepository };
}

/** Refresh provider-owned repository identity without discarding page status data. */
async function refreshRepository(): Promise<void> {
  if (!repository.value || refreshing.value) return;
  refreshing.value = true;
  try {
    handleRepositoryUpdated((await api.repositories.refresh(repository.value.id)).data);
    toast.add({ color: 'success', title: t('repositoryDetails.refreshSuccess') });
  } catch {
    toast.add({ color: 'error', title: t('repositoryDetails.refreshError') });
  } finally {
    refreshing.value = false;
  }
}

/** Queue a read-only synchronization and immediately reflect the active job. */
async function syncRepository(): Promise<void> {
  if (!repository.value || syncing.value) return;
  syncing.value = true;
  try {
    await api.repositories.sync(repository.value.id);
    repository.value.syncState.status = 'PENDING';
    toast.add({ color: 'success', title: t('repositoryDetails.syncWorkflowRunsQueued') });
  } catch {
    toast.add({ color: 'error', title: t('repositoryDetails.syncWorkflowRunsError') });
  } finally {
    syncing.value = false;
  }
}

watch(repositoryId, (id) => void load(id), { immediate: true });
</script>
