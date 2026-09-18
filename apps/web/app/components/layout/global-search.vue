<template>
  <div class="relative block">
    <div
      class="flex w-44 items-center rounded-md border border-default bg-elevated px-3 transition-colors focus-within:border-primary sm:w-72"
      @click="searchInput?.focus()"
    >
      <span class="font-display text-xs font-semibold text-primary">&gt;_</span>
      <input
        ref="searchInput"
        v-model="query"
        aria-autocomplete="list"
        autocomplete="off"
        class="w-full border-0 bg-transparent py-1.5 pl-2 text-sm outline-none placeholder:text-muted"
        role="combobox"
        :aria-controls="isOpen ? 'global-search-results' : undefined"
        :aria-expanded="isOpen"
        :aria-label="t('layout.search')"
        :placeholder="t('layout.searchPlaceholder')"
        @focus="isOpen = true"
        @keydown.escape="close"
      />
      <UKbd class="ml-auto hidden font-mono text-[10px] lg:inline-flex">/</UKbd>
    </div>

    <div
      v-if="isOpen"
      id="global-search-results"
      class="fixed inset-x-4 top-14 z-50 overflow-hidden rounded-lg border border-default bg-default shadow-lg sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-1 sm:w-[28rem]"
      role="listbox"
      :aria-label="t('layout.searchResults')"
    >
      <p v-if="!canSearch" class="px-4 py-5 text-center text-sm text-muted">
        {{ t('layout.searchHint') }}
      </p>

      <template v-else>
        <div class="flex min-h-9 items-center justify-between border-b border-default px-3 py-2">
          <span class="text-xs text-muted">{{ t('layout.searchResults') }}</span>
          <UIcon v-if="isSearching" class="size-4 animate-spin text-muted" name="i-tabler-loader-2" />
        </div>

        <div v-if="hasResults" class="max-h-[min(60vh,28rem)] overflow-y-auto py-1">
          <template v-if="navigationResults.length">
            <p class="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted">
              {{ t('layout.searchNavigation') }}
            </p>
            <NuxtLink
              v-for="item in navigationResults"
              :key="item.to"
              class="flex items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-none"
              role="option"
              :aria-label="item.label"
              :to="item.to"
              @click="close"
            >
              <UIcon class="size-4 shrink-0 text-muted" :name="item.icon" />
              <span class="font-medium">{{ item.label }}</span>
            </NuxtLink>
          </template>

          <template v-if="providerAccountResults.length">
            <p class="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted">
              {{ t('layout.searchProviders') }}
            </p>
            <NuxtLink
              v-for="provider in providerAccountResults"
              :key="provider.id"
              class="flex items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-none"
              role="option"
              to="/admin/providers"
              :aria-label="`${provider.displayName}, ${provider.providerType}`"
              @click="close"
            >
              <UIcon class="size-4 shrink-0 text-muted" name="i-lucide-plug-zap" />
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">{{ provider.displayName }}</span>
                <span class="block truncate text-xs text-muted">{{ provider.baseUrl ?? provider.providerType }}</span>
              </span>
              <EnumsProviderTypeBadge size="xs" variant="subtle" :value="provider.providerType" />
            </NuxtLink>
          </template>

          <template v-if="repositoryResults.length">
            <p class="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted">
              {{ t('layout.searchRepositories') }}
            </p>
            <NuxtLink
              v-for="repository in repositoryResults"
              :key="repository.id"
              class="flex items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-none"
              role="option"
              :aria-label="`${repository.owner}/${repository.name}`"
              :to="{ path: '/repositories', query: { repository: repository.id } }"
              @click="close"
            >
              <UIcon class="size-4 shrink-0 text-muted" name="i-lucide-git-fork" />
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">{{ repository.owner }}/{{ repository.name }}</span>
                <span class="block truncate text-xs text-muted">{{ repositoryHost(repository.url) }}</span>
              </span>
            </NuxtLink>
          </template>

          <template v-if="workflowRunResults.length">
            <p class="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted">
              {{ t('layout.searchWorkflowRuns') }}
            </p>
            <a
              v-for="workflowRun in workflowRunResults"
              :key="workflowRun.id"
              class="flex items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-none"
              rel="noopener"
              role="option"
              target="_blank"
              :aria-label="`${workflowRun.workflowName}, ${workflowRun.repositoryOwner}/${workflowRun.repositoryName}`"
              :href="workflowRun.url"
              @click="close"
            >
              <UIcon name="i-tabler-activity" class="size-4 shrink-0 text-muted" />
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">{{ workflowRun.workflowName }}</span>
                <span class="block truncate text-xs text-muted">
                  {{ workflowRun.repositoryOwner }}/{{ workflowRun.repositoryName }} · {{ workflowRun.displayTitle }}
                </span>
              </span>
              <UBadge size="xs" variant="subtle">{{ t(`workflowStatus.${workflowRun.status}`) }}</UBadge>
            </a>
          </template>
        </div>

        <div v-if="failedGroups.length" class="border-t border-default px-3 py-2" role="status">
          <p class="text-xs text-warning">{{ t('layout.searchPartialError') }}</p>
          <p class="mt-0.5 text-xs text-muted">{{ failedGroups.join(', ') }}</p>
        </div>

        <p v-if="!isSearching && !hasResults" class="px-4 py-5 text-center text-sm text-muted">
          {{ t('layout.searchNoResults') }}
        </p>
        <span class="sr-only" aria-live="polite">
          {{ isSearching ? t('layout.searchLoading') : t('layout.searchResultCount', { count: resultCount }) }}
        </span>
      </template>
    </div>

    <div v-if="isOpen" class="fixed inset-0 z-40" @click="close" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { createShortcutBindings } from '~/util/shortcuts';

import { useGlobalSearch } from '~/composables/app/global-search';

const { t } = useI18n();
const searchInput = ref<HTMLInputElement>();
const query = ref('');
const isOpen = ref(false);
const {
  canSearch,
  hasResults,
  isSearching,
  navigationResults,
  providerAccountResults,
  providerAccounts,
  repositories,
  repositoryResults,
  workflowRunResults,
  workflowRuns,
} = useGlobalSearch(query);
const failedGroups = computed(() => [
  ...(providerAccounts.error.value ? [t('layout.searchProviders')] : []),
  ...(repositories.error.value ? [t('layout.searchRepositories')] : []),
  ...(workflowRuns.error.value ? [t('layout.searchWorkflowRuns')] : []),
]);
const resultCount = computed(
  () =>
    navigationResults.value.length +
    providerAccountResults.value.length +
    repositoryResults.value.length +
    workflowRunResults.value.length,
);

/** Return a concise host label without trusting search result URLs as navigation text. */
function repositoryHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Dismiss the search overlay and restore a neutral search state. */
function close(): void {
  isOpen.value = false;
}

defineShortcuts(
  createShortcutBindings({
    search: () => {
      if (document.querySelector('[role="dialog"]')) return;
      isOpen.value = true;
      searchInput.value?.focus();
    },
  }),
);
</script>
