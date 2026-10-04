<template>
  <UDashboardSidebar
    id="ezrepo"
    collapsible
    resizable
    class="bg-elevated/25"
    role="complementary"
    :default-size="16"
    :aria-label="t('layout.sidebarNavigation')"
    :ui="{ footer: 'flex-col items-stretch' }"
  >
    <template #header="{ collapsed }">
      <NuxtLink
        to="/"
        aria-label="ezRepo"
        class="flex items-center gap-2 font-display text-xl font-bold"
        :class="collapsed ? 'mx-auto' : undefined"
      >
        <img src="/logo.svg" alt="" class="size-7 shrink-0" />
        <span v-if="!collapsed">
          <span class="text-primary">ez</span>
          <span class="tracking-tight text-highlighted">Repo</span>
        </span>
      </NuxtLink>
    </template>

    <template #default="{ collapsed }">
      <UNavigationMenu
        orientation="vertical"
        :aria-label="t('layout.primaryNavigation')"
        :collapsed="collapsed"
        :items="navigationItems"
        popover
        tooltip
      />
    </template>

    <template #footer="{ collapsed }">
      <LayoutSidebarFooter :collapsed="collapsed" />
    </template>
  </UDashboardSidebar>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';

import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import { useModuleApi } from '~/composables/api/module-api';
import { useSystemStatusState } from '~/composables/api/system-status';
import { useNavigationItems } from '~/composables/app/navigation-items';

const { t } = useI18n();
const route = useRoute();
const api = useEzRepoApi();
const { snapshot: systemStatus } = useSystemStatusState();
const needsAttentionApi = useModuleApi('workflow-runs/needs-attention');
const awaitingApprovalCount = ref<number | null>(null);
const needsAttentionCount = ref<number | null>(null);
const { navigationItems } = useNavigationItems({
  awaitingApproval: awaitingApprovalCount,
  needsAttention: needsAttentionCount,
});

/** Load permission-scoped workflow attention counters without blocking the application shell. */
async function loadAttentionCounts(): Promise<void> {
  const [awaitingApprovalResult, needsAttentionResult] = await Promise.allSettled([
    api.dashboard.getAwaitingApproval(),
    needsAttentionApi.query({ fields: 'id', page: 1, perPage: 1 }),
  ]);

  awaitingApprovalCount.value =
    awaitingApprovalResult.status === 'fulfilled' ? awaitingApprovalResult.value.data.length : null;
  needsAttentionCount.value =
    needsAttentionResult.status === 'fulfilled' ? needsAttentionResult.value.data.meta.itemCount : null;
}

onMounted(() => void loadAttentionCounts());
watch(() => route.fullPath, loadAttentionCounts);

let observedProviderSync = false;
watch(
  () => systemStatus.value.activity,
  (activity) => {
    if (activity) {
      observedProviderSync = true;
      return;
    }
    if (!observedProviderSync) return;
    observedProviderSync = false;
    void loadAttentionCounts();
  },
);
</script>
