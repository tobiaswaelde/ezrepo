<template>
  <UModal
    v-model:open="open"
    :description="$t('mcp.adminDescription', { username: user?.username ?? '' })"
    :title="$t('mcp.adminTitle')"
  >
    <template #body>
      <UAlert
        v-if="loadError"
        color="error"
        icon="i-lucide-circle-alert"
        variant="subtle"
        :title="$t('mcp.loadError')"
      />
      <div v-else-if="loading" class="space-y-3">
        <USkeleton v-for="index in 2" :key="index" class="h-14 w-full" />
      </div>
      <p v-else-if="tokens.length === 0" class="text-sm text-muted">{{ $t('mcp.empty') }}</p>
      <ul v-else class="divide-y divide-default">
        <li v-for="token in tokens" :key="token.id" class="flex flex-wrap items-center justify-between gap-4 py-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium">{{ token.name }}</span>
              <UBadge variant="subtle" :color="statusColor(token.status)">
                {{ $t(`mcp.status.${token.status}`) }}
              </UBadge>
            </div>
            <p class="mt-1 font-mono text-xs text-muted">{{ token.tokenPrefix }}…</p>
            <p class="mt-1 text-xs text-muted">
              {{ $t('mcp.createdAt', { date: formatTimestamp(token.createdAt) }) }} ·
              {{
                token.lastUsedAt
                  ? $t('mcp.lastUsedAt', { date: formatTimestamp(token.lastUsedAt) })
                  : $t('mcp.neverUsed')
              }}
              ·
              {{
                token.expiresAt
                  ? $t('mcp.expiresAt', { date: formatTimestamp(token.expiresAt) })
                  : $t('mcp.neverExpires')
              }}
            </p>
          </div>
          <UButton
            color="error"
            icon="i-lucide-ban"
            size="sm"
            variant="soft"
            :disabled="token.status === 'REVOKED'"
            :label="$t('mcp.revoke')"
            :loading="revokingId === token.id"
            @click="revoke(token)"
          />
        </li>
      </ul>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

import { defineModel, defineProps } from 'vue';
import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import { useDateTime } from '~/composables/use-date-time';
import type { McpAccessToken, McpAccessTokenStatus, User } from '~/types/api/resources';

const open = defineModel<boolean>('open', { required: true });
const props = defineProps<{ user: User | null }>();
const { t } = useI18n();
const api = useEzRepoApi();
const { formatDateTime } = useDateTime();
const tokens = ref<McpAccessToken[]>([]);
const loading = ref(false);
const loadError = ref(false);
const revokingId = ref<string>();

function formatTimestamp(timestamp: string): string {
  return formatDateTime(timestamp);
}

function statusColor(status: McpAccessTokenStatus): 'error' | 'neutral' | 'success' {
  if (status === 'ACTIVE') return 'success';
  if (status === 'REVOKED') return 'error';
  return 'neutral';
}

watch(open, (isOpen) => {
  if (isOpen) void load();
});

async function load(): Promise<void> {
  if (!props.user) return;
  loading.value = true;
  loadError.value = false;
  try {
    tokens.value = (await api.mcpTokens.list(props.user.id)).data;
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

async function revoke(token: McpAccessToken): Promise<void> {
  if (!window.confirm(t('mcp.revokeConfirm', { name: token.name }))) return;
  revokingId.value = token.id;
  try {
    await api.mcpTokens.revoke(token.id);
    await load();
  } finally {
    revokingId.value = undefined;
  }
}
</script>
