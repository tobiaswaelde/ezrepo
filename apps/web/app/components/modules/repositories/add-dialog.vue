<template>
  <UModal
    v-model:open="open"
    :description="$t('repositories.addDescription')"
    :dismissible="!addingRepository"
    :title="$t('repositories.addDialogTitle')"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <UAlert
        v-if="addingRepositoryError"
        color="error"
        icon="i-lucide-circle-alert"
        variant="subtle"
        :title="$t('repositories.addError')"
      />
      <UAlert
        v-else-if="providerAccountsError"
        color="error"
        icon="i-lucide-circle-alert"
        variant="subtle"
        :title="$t('repositories.providerLoadError')"
      />

      <UStepper ref="stepper" class="mt-4" color="neutral" size="sm" :items="stepperItems">
        <template #provider>
          <div class="space-y-4">
            <p class="text-sm text-muted">{{ $t('repositories.providerDescription') }}</p>
            <UFormField :label="$t('repositories.provider')" required>
              <USelectMenu
                v-model="selectedProviderAccountId"
                class="w-full"
                value-key="value"
                :items="providerOptions"
                :loading="providerAccountsLoading"
                :placeholder="$t('repositories.providerPlaceholder')"
                searchable
              />
            </UFormField>
            <UAlert
              v-if="!providerAccountsLoading && !providerAccountsError && providerOptions.length === 0"
              color="warning"
              :title="$t('repositories.noEnabledProviders')"
            />
          </div>
        </template>

        <template #repository>
          <div class="space-y-4">
            <p class="text-sm text-muted">{{ $t('repositories.repositoryDescription') }}</p>
            <UAlert
              v-if="repositoriesError"
              color="error"
              icon="i-lucide-circle-alert"
              variant="subtle"
              :title="$t('repositories.repositoryLoadError')"
            />
            <ModulesRepositoriesRepositorySelectionTable
              :key="selectedProviderAccountId"
              v-model:selected-repository-ids="selectedProviderRepositoryIds"
              :loading="repositoriesLoading"
              :repositories="availableRepositories"
            />
            <UAlert
              v-if="
                !repositoriesLoading &&
                !repositoriesError &&
                selectedProviderAccountId &&
                selectableRepositories.length === 0
              "
              color="info"
              :title="$t('repositories.noAvailableRepositories')"
            />
          </div>
        </template>
      </UStepper>

      <div class="mt-6 flex justify-between border-t border-default pt-4">
        <UButton
          color="neutral"
          icon="i-lucide-arrow-left"
          variant="soft"
          :label="$t('repositories.back')"
          :disabled="addingRepository || !stepper?.hasPrev"
          @click="stepper?.prev()"
        />
        <UButton
          v-if="stepper?.hasNext"
          color="neutral"
          trailing-icon="i-lucide-arrow-right"
          variant="soft"
          :disabled="!selectedProviderAccountId || providerAccountsLoading || repositoriesLoading"
          :label="$t('repositories.next')"
          :loading="providerAccountsLoading || repositoriesLoading"
          @click="stepper?.next()"
        />
        <UButton
          v-else
          :disabled="selectedProviderRepositoryIds.length === 0 || addingRepository"
          :label="$t('repositories.addSelected', { count: selectedProviderRepositoryIds.length })"
          :loading="addingRepository"
          @click="addRepositories"
        />
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { defineEmits, defineModel } from 'vue';
import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import { useProviderType } from '~/composables/enums/provider-type';
import type { ProviderAccount, ProviderRepository } from '~/types/api/resources';

const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{
  created: [];
}>();

const { t } = useI18n();
const api = useEzRepoApi();
const { getLabel: getProviderTypeLabel } = useProviderType();
const providerAccounts = ref<ProviderAccount[]>([]);
const providerAccountsLoading = ref(false);
const providerAccountsError = ref(false);
const availableRepositories = ref<ProviderRepository[]>([]);
const repositoriesLoading = ref(false);
const repositoriesError = ref(false);
const addingRepository = ref(false);
const addingRepositoryError = ref(false);
const selectedProviderAccountId = ref<string>();
const selectedProviderRepositoryIds = ref<string[]>([]);
const stepper = useTemplateRef('stepper');
const stepperItems = computed(() => [
  { icon: 'i-lucide-plug-zap', slot: 'provider', title: t('repositories.addSteps.provider') },
  { icon: 'i-lucide-git-branch', slot: 'repository', title: t('repositories.addSteps.repository') },
]);
const providerOptions = computed(() =>
  providerAccounts.value.map((account) => ({
    label: `${account.displayName} (${getProviderTypeLabel(account.providerType)})`,
    value: account.id,
  })),
);
const selectableRepositories = computed(() => availableRepositories.value.filter((repository) => !repository.tracked));

watch(open, (isOpen) => {
  if (isOpen) void initialize();
});

watch(selectedProviderAccountId, (providerAccountId) => {
  selectedProviderRepositoryIds.value = [];
  availableRepositories.value = [];
  repositoriesError.value = false;
  if (providerAccountId) void loadAvailableRepositories(providerAccountId);
});

/** Reset the dialog before loading enabled provider accounts. */
async function initialize(): Promise<void> {
  addingRepositoryError.value = false;
  availableRepositories.value = [];
  providerAccountsError.value = false;
  repositoriesError.value = false;
  selectedProviderAccountId.value = undefined;
  selectedProviderRepositoryIds.value = [];
  providerAccountsLoading.value = true;

  try {
    const { data } = await api.providerAccounts.list();
    providerAccounts.value = data.items.filter((account) => account.enabled);
  } catch {
    providerAccountsError.value = true;
  } finally {
    providerAccountsLoading.value = false;
  }
}

/** Load the provider-owned repository list for the selected provider account. */
async function loadAvailableRepositories(providerAccountId: string): Promise<void> {
  repositoriesLoading.value = true;
  repositoriesError.value = false;

  try {
    const { data } = await api.providerAccounts.listRepositories(providerAccountId);
    if (selectedProviderAccountId.value === providerAccountId) availableRepositories.value = data;
  } catch {
    if (selectedProviderAccountId.value === providerAccountId) repositoriesError.value = true;
  } finally {
    if (selectedProviderAccountId.value === providerAccountId) repositoriesLoading.value = false;
  }
}

/** Add all selected provider repositories and retain any failed selections for retry. */
async function addRepositories(): Promise<void> {
  const providerAccountId = selectedProviderAccountId.value;
  const repositoryIds = [...selectedProviderRepositoryIds.value];
  if (!providerAccountId || repositoryIds.length === 0) return;

  addingRepository.value = true;
  addingRepositoryError.value = false;
  try {
    const results = await Promise.allSettled(
      repositoryIds.map((providerRepositoryId) =>
        api.providerAccounts.addRepository(providerAccountId, providerRepositoryId),
      ),
    );
    const successfulIds = new Set(repositoryIds.filter((_, index) => results[index]?.status === 'fulfilled'));
    const failedIds = repositoryIds.filter((_, index) => results[index]?.status === 'rejected');

    if (successfulIds.size > 0) {
      availableRepositories.value = availableRepositories.value.map((repository) =>
        successfulIds.has(repository.providerRepositoryId) ? { ...repository, tracked: true } : repository,
      );
      emit('created');
    }
    if (failedIds.length > 0) {
      selectedProviderRepositoryIds.value = failedIds;
      addingRepositoryError.value = true;
      return;
    }

    open.value = false;
  } finally {
    addingRepository.value = false;
  }
}
</script>
