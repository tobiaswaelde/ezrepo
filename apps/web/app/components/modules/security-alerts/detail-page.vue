<template>
  <LayoutPage
    :breadcrumbs="[
      { icon: 'i-lucide-layout-dashboard', label: $t('layout.dashboard'), to: '/' },
      { icon: 'i-lucide-shield-alert', label: $t('securityAlerts.title'), to: listPath },
      { label: alert?.title ?? '…' },
    ]"
    :title="alert?.title ?? $t('securityAlerts.title')"
  >
    <template #actions>
      <UButton
        v-if="alert"
        color="neutral"
        icon="i-tabler-external-link"
        rel="noreferrer"
        target="_blank"
        variant="soft"
        :label="$t('dashboard.openProvider')"
        :to="alert.providerUrl"
      />
    </template>
    <USkeleton v-if="loading" class="h-80 w-full" />
    <UAlert
      v-else-if="error"
      color="error"
      icon="i-lucide-circle-alert"
      variant="subtle"
      :title="$t('securityAlerts.loadError')"
    />
    <div v-else-if="alert" class="space-y-6">
      <UCard>
        <div class="flex flex-wrap gap-2">
          <UBadge color="neutral" variant="subtle">{{ $t(`securityAlerts.kindTitles.${alert.kind}`) }}</UBadge>
          <UBadge color="neutral" variant="subtle">{{ $t(`securityAlerts.states.${alert.state}`) }}</UBadge>
          <UBadge color="warning" variant="subtle">{{ $t(`securityAlerts.severities.${alert.severity}`) }}</UBadge>
        </div>
        <dl class="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-muted">{{ $t('securityAlerts.columns.repository') }}</dt>
            <dd>{{ alert.repositoryOwner }}/{{ alert.repositoryName }}</dd>
          </div>
          <div>
            <dt class="text-muted">{{ $t('securityAlerts.columns.updated') }}</dt>
            <dd>{{ formatDateTime(alert.providerUpdatedAt) }}</dd>
          </div>
          <div v-if="alert.packageName">
            <dt class="text-muted">{{ $t('securityAlerts.columns.package') }}</dt>
            <dd>{{ alert.packageName }}</dd>
          </div>
          <div v-if="alert.ruleId">
            <dt class="text-muted">{{ $t('securityAlerts.columns.rule') }}</dt>
            <dd>{{ alert.ruleId }}</dd>
          </div>
          <div v-if="alert.secretType">
            <dt class="text-muted">{{ $t('securityAlerts.columns.secretType') }}</dt>
            <dd>{{ alert.secretType }}</dd>
          </div>
          <div v-if="locationPath">
            <dt class="text-muted">{{ $t('securityAlerts.columns.path') }}</dt>
            <dd class="font-mono">{{ locationPath }}</dd>
          </div>
        </dl>
      </UCard>
      <UCard>
        <template #header>
          <h2 class="font-semibold">{{ $t('workItems.description') }}</h2>
        </template>
        <p class="whitespace-pre-wrap text-sm">{{ alert.description || $t('workItems.noDescription') }}</p>
      </UCard>
    </div>
  </LayoutPage>
</template>

<script setup lang="ts">
import { defineProps } from 'vue';
import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import { useDateTime } from '~/composables/use-date-time';
import type { SecurityAlert } from '~/types/api/resources';

const props = defineProps<{ id: string }>();
const api = useEzRepoApi();
const { formatDateTime } = useDateTime();
const alert = ref<SecurityAlert | null>(null);
const loading = ref(true);
const error = ref(false);
const listPath = computed(() =>
  alert.value
    ? `/alerts/${{ DEPENDENCY: 'dependencies', CODE: 'code', SECRET: 'secrets' }[alert.value.kind]}`
    : '/alerts/dependencies',
);
const locationPath = computed(() =>
  typeof alert.value?.location?.path === 'string' ? alert.value.location.path : null,
);
onMounted(async () => {
  try {
    alert.value = (await api.securityAlerts.get(props.id)).data;
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
});
</script>
