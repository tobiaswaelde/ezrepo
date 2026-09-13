<template>
  <UModal v-model:open="open" :title="$t('notifications.historyView.detailsTitle')">
    <template #body>
      <div v-if="delivery" class="space-y-5">
        <dl class="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-muted">{{ $t('notifications.columns.repository') }}</dt>
            <dd>{{ delivery.repositoryOwner }}/{{ delivery.repositoryName }}</dd>
          </div>
          <div>
            <dt class="text-muted">{{ $t('notifications.columns.kind') }}</dt>
            <dd>{{ $t(`notifications.deliveryKinds.${delivery.kind}`) }}</dd>
          </div>
          <div>
            <dt class="text-muted">{{ $t('notifications.columns.workflow') }}</dt>
            <dd>{{ delivery.workflowName ?? delivery.testChannelName ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-muted">{{ $t('notifications.columns.status') }}</dt>
            <dd>{{ $t(`notificationDeliveryStatus.${delivery.status}`) }}</dd>
          </div>
          <div v-if="delivery.workflowPattern">
            <dt class="text-muted">{{ $t('notifications.fields.workflowPattern') }}</dt>
            <dd>
              <code>{{ delivery.workflowPattern }}</code>
            </dd>
          </div>
          <div v-if="delivery.requestedByUsername">
            <dt class="text-muted">{{ $t('notifications.historyView.requestedBy') }}</dt>
            <dd>@{{ delivery.requestedByUsername }}</dd>
          </div>
        </dl>
        <UAlert v-if="delivery.finalError" color="error" variant="subtle" :description="delivery.finalError" />
        <div>
          <h3 class="mb-2 font-semibold">{{ $t('notifications.historyView.attempts') }}</h3>
          <div class="divide-y divide-default rounded-lg border border-default">
            <div
              v-for="attempt in delivery.attempts"
              :key="attempt.id"
              class="flex items-start justify-between gap-4 p-3 text-sm"
            >
              <div>
                <p class="font-medium">{{ attempt.notificationChannelName }}</p>
                <p v-if="attempt.deviceLabel" class="line-clamp-1 text-xs text-muted">{{ attempt.deviceLabel }}</p>
                <p v-if="attempt.error" class="text-xs text-error">{{ attempt.error }}</p>
              </div>
              <div class="shrink-0 text-right text-xs text-muted">
                <p>{{ $t('notifications.historyView.attemptNumber', { count: attempt.attempt }) }}</p>
                <p>{{ formatDateTime(attempt.createdAt) }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { useDateTime } from '~/composables/use-date-time';
import type { NotificationDelivery } from '~/types/api/resources';
defineProps<{ delivery: NotificationDelivery | null }>();
const open = defineModel<boolean>('open', { required: true });
const { formatDateTime } = useDateTime();
</script>
