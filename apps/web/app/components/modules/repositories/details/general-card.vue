<template>
  <UCard class="lg:col-span-2" :ui="{ body: 'space-y-4' }">
    <template #header>
      <div>
        <h2 class="font-semibold">{{ repository.owner }}/{{ repository.name }}</h2>
        <p class="text-sm text-muted">
          {{ editable ? $t('repositoryDetails.generalDescription') : $t('repositories.description') }}
        </p>
      </div>
    </template>

    <dl v-if="!editable" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <div>
        <dt class="text-xs font-medium uppercase tracking-wide text-muted">{{ $t('repositories.columns.status') }}</dt>
        <dd class="mt-1">
          <UBadge variant="subtle" :color="repository.enabled ? 'success' : 'neutral'">
            {{ repository.enabled ? $t('repositories.enabled') : $t('repositories.disabled') }}
          </UBadge>
        </dd>
      </div>
      <div>
        <dt class="text-xs font-medium uppercase tracking-wide text-muted">
          {{ $t('repositories.columns.retention') }}
        </dt>
        <dd class="mt-1 text-sm">
          {{ repository.workflowRunRetentionDays ?? $t('repositories.default') }}
        </dd>
      </div>
      <div>
        <dt class="text-xs font-medium uppercase tracking-wide text-muted">
          {{ $t('repositoryDetails.issueRetention') }}
        </dt>
        <dd class="mt-1 text-sm">{{ repository.issueRetentionDays ?? $t('repositories.default') }}</dd>
      </div>
      <div>
        <dt class="text-xs font-medium uppercase tracking-wide text-muted">
          {{ $t('repositoryDetails.pullRequestRetention') }}
        </dt>
        <dd class="mt-1 text-sm">{{ repository.pullRequestRetentionDays ?? $t('repositories.default') }}</dd>
      </div>
      <div>
        <dt class="text-xs font-medium uppercase tracking-wide text-muted">
          {{ $t('repositories.columns.lastSync') }}
        </dt>
        <dd class="mt-1 text-sm">{{ formatLastSync(repository.lastSyncAt) }}</dd>
      </div>
    </dl>

    <UAlert
      v-if="saveError"
      color="error"
      icon="i-lucide-circle-alert"
      variant="subtle"
      :title="$t('repositoryDetails.saveError')"
    />
    <div v-if="editable" class="grid gap-4 lg:grid-cols-3">
      <UFormField :help="$t('repositoryDetails.retentionHelp')" :label="$t('repositoryDetails.retention')">
        <UInput v-model="retentionDays.workflowRuns" max="3650" min="1" type="number" :disabled="saving" />
      </UFormField>
      <UFormField :help="$t('repositoryDetails.retentionHelp')" :label="$t('repositoryDetails.issueRetention')">
        <UInput v-model="retentionDays.issues" max="3650" min="1" type="number" :disabled="saving" />
      </UFormField>
      <UFormField :help="$t('repositoryDetails.retentionHelp')" :label="$t('repositoryDetails.pullRequestRetention')">
        <UInput v-model="retentionDays.pullRequests" max="3650" min="1" type="number" :disabled="saving" />
      </UFormField>
      <div class="flex justify-end lg:col-span-3">
        <UButton :disabled="saving" :label="$t('repositoryDetails.save')" :loading="saving" @click="saveRetention" />
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';

import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import { useDateTime } from '~/composables/use-date-time';
import type { Repository } from '~/types/api/resources';

const props = defineProps<{
  editable: boolean;
  repository: Repository;
}>();
const emit = defineEmits<{
  updated: [repository: Repository];
}>();

const { t } = useI18n();
const api = useEzRepoApi();
const { formatDateTime } = useDateTime();
const retentionDays = reactive({ issues: '', pullRequests: '', workflowRuns: '' });
const saving = ref(false);
const saveError = ref(false);

watch(
  () => props.repository,
  (repository) => {
    retentionDays.issues = repository.issueRetentionDays?.toString() ?? '';
    retentionDays.pullRequests = repository.pullRequestRetentionDays?.toString() ?? '';
    retentionDays.workflowRuns = repository.workflowRunRetentionDays?.toString() ?? '';
  },
  { immediate: true },
);

/** Format the last successful synchronization using the active interface locale. */
function formatLastSync(lastSyncAt: string | null): string {
  return lastSyncAt ? formatDateTime(lastSyncAt) : t('repositories.neverSynced');
}

/** Persist a valid explicit retention override or restore the provider default. */
async function saveRetention(): Promise<void> {
  const parseRetention = (value: string | number): number | null =>
    String(value).trim() === '' ? null : Number(value);
  const issueRetentionDays = parseRetention(retentionDays.issues);
  const pullRequestRetentionDays = parseRetention(retentionDays.pullRequests);
  const workflowRunRetentionDays = parseRetention(retentionDays.workflowRuns);
  const values = [issueRetentionDays, pullRequestRetentionDays, workflowRunRetentionDays];
  if (values.some((value) => value !== null && (!Number.isInteger(value) || value < 1 || value > 3650))) return;

  saving.value = true;
  saveError.value = false;
  try {
    await api.repositories.update(props.repository.id, {
      enabled: props.repository.enabled,
      issueRetentionDays,
      pullRequestRetentionDays,
      workflowRunRetentionDays,
    });
    emit('updated', { ...props.repository, issueRetentionDays, pullRequestRetentionDays, workflowRunRetentionDays });
  } catch {
    saveError.value = true;
  } finally {
    saving.value = false;
  }
}
</script>
