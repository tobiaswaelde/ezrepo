<template>
  <LayoutPage
    :breadcrumbs="[
      { icon: 'i-lucide-layout-dashboard', label: $t('layout.dashboard'), to: '/' },
      { icon, label: listTitle, to: `/${endpoint}` },
      { icon, label: item ? `#${item.number}` : '…' },
    ]"
    :title="item?.title ?? listTitle"
  >
    <template #actions>
      <UButton
        v-if="item"
        color="neutral"
        icon="i-tabler-external-link"
        rel="noreferrer"
        target="_blank"
        variant="soft"
        :label="
          $t(
            item.providerType === 'GITLAB' && kind === 'pull-request'
              ? 'pullRequests.openMergeRequest'
              : 'workItems.openProvider',
          )
        "
        :to="item.url"
      />
    </template>
    <USkeleton v-if="loading" class="h-80 w-full" />
    <UAlert
      v-else-if="error"
      color="error"
      icon="i-lucide-circle-alert"
      variant="subtle"
      :title="$t('workItems.loadError')"
    />
    <template v-else-if="item">
      <UCard>
        <div class="flex flex-wrap items-center gap-2">
          <UBadge color="neutral" variant="subtle">#{{ item.number }}</UBadge>
          <UBadge color="neutral" variant="subtle">{{ $t(`workItems.states.${item.state}`) }}</UBadge>
          <EnumsProviderTypeBadge variant="subtle" :value="item.providerType" />
          <UBadge
            v-if="'workflowApprovalRequired' in item && item.workflowApprovalRequired"
            color="warning"
            variant="subtle"
          >
            {{ $t('pullRequests.approvalRequired') }}
          </UBadge>
        </div>
        <dl class="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-muted">{{ $t('workItems.repository') }}</dt>
            <dd>{{ item.repositoryOwner }}/{{ item.repositoryName }}</dd>
          </div>
          <div>
            <dt class="text-muted">{{ $t('workItems.columns.author') }}</dt>
            <dd>{{ item.author?.username ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-muted">{{ $t('workItems.columns.created') }}</dt>
            <dd>{{ formatDateTime(item.providerCreatedAt) }}</dd>
          </div>
          <div>
            <dt class="text-muted">{{ $t('workItems.columns.updated') }}</dt>
            <dd>{{ formatDateTime(item.providerUpdatedAt) }}</dd>
          </div>
          <template v-if="'sourceBranch' in item">
            <div>
              <dt class="text-muted">{{ $t('pullRequests.sourceBranch') }}</dt>
              <dd class="font-mono">{{ item.sourceBranch }}</dd>
            </div>
            <div>
              <dt class="text-muted">{{ $t('pullRequests.targetBranch') }}</dt>
              <dd class="font-mono">{{ item.targetBranch }}</dd>
            </div>
          </template>
        </dl>
        <ModulesWorkItemsLabels v-if="item.labels.length" class="mt-5" :labels="item.labels" />
      </UCard>
      <UCard>
        <template #header>
          <h2 class="font-semibold">{{ $t('workItems.description') }}</h2>
        </template>
        <CommonSafeMarkdown v-if="item.body" :source="item.body" />
        <p v-else class="text-sm text-muted">{{ $t('workItems.noDescription') }}</p>
      </UCard>
    </template>
  </LayoutPage>
</template>

<script setup lang="ts">
import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import { useDateTime } from '~/composables/use-date-time';
import type { Issue, PullRequest } from '~/types/api/resources';

const props = defineProps<{ id: string; kind: 'issue' | 'pull-request' }>();
const { t } = useI18n();
const api = useEzRepoApi();
const { formatDateTime } = useDateTime();
const item = ref<Issue | PullRequest | null>(null);
const loading = ref(true);
const error = ref(false);
const endpoint = props.kind === 'issue' ? 'issues' : 'pull-requests';
const icon = props.kind === 'issue' ? 'i-tabler-circle-dot' : 'i-tabler-git-pull-request';
const listTitle = computed(() => t(props.kind === 'issue' ? 'issues.title' : 'pullRequests.title'));

onMounted(async () => {
  try {
    item.value = (await (props.kind === 'issue' ? api.issues.get(props.id) : api.pullRequests.get(props.id))).data;
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
});
</script>
