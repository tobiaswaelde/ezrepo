<template>
  <UCard :ui="{ body: 'p-0 sm:p-0' }">
    <template #header>
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-2">
          <UIcon class="size-5 text-muted" :name="icon" />
          <h2 class="font-semibold">{{ title }}</h2>
        </div>
        <UButton
          color="neutral"
          trailing-icon="i-lucide-arrow-right"
          variant="ghost"
          :label="$t('repositoryDetails.viewAll')"
          :to="pageUrl"
        />
      </div>
    </template>

    <div v-if="loading" class="space-y-3 p-4">
      <USkeleton v-for="index in 3" :key="index" class="h-12 w-full" />
    </div>
    <UAlert
      v-else-if="loadError"
      class="m-4"
      color="error"
      icon="i-lucide-circle-alert"
      variant="subtle"
      :title="$t('repositoryDetails.activityLoadError', { resource: title })"
    />
    <p v-else-if="items.length === 0" class="p-6 text-center text-sm text-muted">
      {{ $t('repositoryDetails.activityEmpty', { resource: title.toLocaleLowerCase() }) }}
    </p>
    <ul v-else class="divide-y divide-default">
      <li v-for="item in items" :key="item.id" class="flex items-center gap-3 px-4 py-3">
        <div class="min-w-0 flex-1">
          <NuxtLink v-if="item.detailUrl" class="font-medium hover:underline" :to="item.detailUrl">
            {{ item.title }}
          </NuxtLink>
          <a v-else class="font-medium hover:underline" rel="noreferrer" target="_blank" :href="item.providerUrl">
            {{ item.title }}
          </a>
          <p class="mt-1 truncate text-xs text-muted">{{ item.subtitle }} · {{ item.timestamp }}</p>
        </div>
        <UBadge color="neutral" variant="subtle">{{ item.status }}</UBadge>
        <UTooltip :text="$t('dashboard.openProvider')">
          <UButton
            color="neutral"
            icon="i-tabler-external-link"
            rel="noreferrer"
            target="_blank"
            variant="ghost"
            :aria-label="$t('dashboard.openProvider')"
            :to="item.providerUrl"
          />
        </UTooltip>
      </li>
    </ul>
  </UCard>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

import { defineProps } from 'vue';
import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import { useDateTime } from '~/composables/use-date-time';

type ActivityKind = 'issues' | 'pullRequests' | 'workflowRuns' | 'securityAlerts';

interface ActivityItem {
  detailUrl?: string;
  id: string;
  providerUrl: string;
  status: string;
  subtitle: string;
  timestamp: string;
  title: string;
}

const props = defineProps<{ kind: ActivityKind; repositoryId: string }>();
const { t } = useI18n();
const api = useEzRepoApi();
const { formatDateTime } = useDateTime();
const items = ref<ActivityItem[]>([]);
const loading = ref(true);
const loadError = ref(false);
const icon = computed(() => {
  if (props.kind === 'issues') return 'i-tabler-circle-dot';
  if (props.kind === 'pullRequests') return 'i-tabler-git-pull-request';
  if (props.kind === 'securityAlerts') return 'i-lucide-shield-alert';
  return 'i-lucide-workflow';
});
const pageUrl = computed(() => {
  if (props.kind === 'issues') return '/issues';
  if (props.kind === 'pullRequests') return '/pull-requests';
  if (props.kind === 'securityAlerts') return `/alerts/dependencies?repositoryId=${props.repositoryId}`;
  return '/workflow-runs';
});
const title = computed(() => t(`repositoryDetails.activity.${props.kind}`));

/** Load and normalize the five newest records for this repository section. */
async function load(repositoryId: string): Promise<void> {
  loading.value = true;
  loadError.value = false;
  items.value = [];
  try {
    if (props.kind === 'issues') {
      const { data } = await api.issues.listForRepository(repositoryId);
      if (props.repositoryId !== repositoryId) return;
      items.value = data.items.map((item) => ({
        detailUrl: `/issues/${item.id}`,
        id: item.id,
        providerUrl: item.url,
        status: t(`workItems.states.${item.state}`),
        subtitle: `#${item.number}`,
        timestamp: formatDateTime(item.providerUpdatedAt),
        title: item.title,
      }));
    } else if (props.kind === 'pullRequests') {
      const { data } = await api.pullRequests.listForRepository(repositoryId);
      if (props.repositoryId !== repositoryId) return;
      items.value = data.items.map((item) => ({
        detailUrl: `/pull-requests/${item.id}`,
        id: item.id,
        providerUrl: item.url,
        status: t(`workItems.states.${item.state}`),
        subtitle: `#${item.number}`,
        timestamp: formatDateTime(item.providerUpdatedAt),
        title: item.title,
      }));
    } else if (props.kind === 'workflowRuns') {
      const { data } = await api.workflowRuns.listForRepository(repositoryId);
      if (props.repositoryId !== repositoryId) return;
      items.value = data.items.map((item) => ({
        id: item.id,
        providerUrl: item.url,
        status: t(`workflowStatus.${item.status}`),
        subtitle: item.workflowName,
        timestamp: formatDateTime(item.completedAt ?? item.providerCreatedAt),
        title: item.displayTitle,
      }));
    } else {
      const { data } = await api.securityAlerts.listForRepository(repositoryId);
      if (props.repositoryId !== repositoryId) return;
      items.value = data.items.map((item) => ({
        detailUrl: `/alerts/${item.id}`,
        id: item.id,
        providerUrl: item.providerUrl,
        status: t(`securityAlerts.states.${item.state}`),
        subtitle: t(`securityAlerts.kindTitles.${item.kind}`),
        timestamp: formatDateTime(item.providerUpdatedAt),
        title: item.title,
      }));
    }
  } catch {
    if (props.repositoryId === repositoryId) loadError.value = true;
  } finally {
    if (props.repositoryId === repositoryId) loading.value = false;
  }
}

watch(
  () => props.repositoryId,
  (repositoryId) => void load(repositoryId),
  { immediate: true },
);
</script>
