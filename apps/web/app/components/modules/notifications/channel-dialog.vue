<template>
  <UModal
    v-model:open="open"
    :description="$t('notifications.channels.dialogDescription')"
    :dismissible="!submitting"
    :title="$t(channel ? 'notifications.channels.editTitle' : 'notifications.channels.createTitle')"
  >
    <template #body>
      <UAlert
        v-if="saveError"
        class="mb-4"
        color="error"
        icon="i-lucide-circle-alert"
        variant="subtle"
        :title="$t('notifications.channels.saveError')"
      />
      <UForm class="space-y-5" :state="form" @submit="save">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="$t('notifications.fields.repository')" required>
            <USelect
              v-model="form.repositoryId"
              class="w-full"
              :disabled="Boolean(channel)"
              :items="repositoryOptions"
            />
          </UFormField>
          <UFormField :label="$t('notifications.fields.name')" required>
            <UInput v-model="form.name" class="w-full" />
          </UFormField>
          <UFormField :label="$t('notifications.fields.type')" required>
            <USelect v-model="form.type" class="w-full" :disabled="Boolean(channel)" :items="typeOptions" />
          </UFormField>
          <UFormField :label="$t('notifications.fields.enabled')">
            <USwitch v-model="form.enabled" />
          </UFormField>
        </div>

        <UCheckbox
          v-if="channel && form.type !== 'BROWSER_PUSH'"
          v-model="replaceConfiguration"
          :label="$t('notifications.channels.replaceConfiguration')"
        />
        <UAlert
          v-if="channel && form.type !== 'BROWSER_PUSH' && !replaceConfiguration"
          color="neutral"
          variant="subtle"
          :description="$t('notifications.channels.secretPreserved')"
        />

        <div v-if="showConfiguration" class="space-y-4 rounded-lg border border-default p-4">
          <template v-if="form.type === 'EMAIL'">
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField :label="$t('notifications.fields.smtpHost')" required>
                <UInput v-model="form.smtpHost" class="w-full" placeholder="smtp.example.com" />
              </UFormField>
              <UFormField :label="$t('notifications.fields.port')">
                <UInput v-model.number="form.port" class="w-full" type="number" min="1" max="65535" />
              </UFormField>
              <UFormField :label="$t('notifications.fields.security')" required>
                <USelect v-model="form.security" class="w-full" :items="securityOptions" />
              </UFormField>
              <UFormField :label="$t('notifications.fields.from')" required>
                <UInput v-model="form.from" class="w-full" type="email" />
              </UFormField>
              <UFormField :label="$t('notifications.fields.username')">
                <UInput v-model="form.username" autocomplete="username" class="w-full" />
              </UFormField>
              <UFormField :label="$t('notifications.fields.password')">
                <UInput v-model="form.password" autocomplete="new-password" class="w-full" type="password" />
              </UFormField>
            </div>
            <UFormField :label="$t('notifications.fields.recipients')" required>
              <UTextarea
                v-model="form.recipients"
                class="w-full"
                :placeholder="$t('notifications.fields.recipientsPlaceholder')"
              />
            </UFormField>
          </template>

          <template v-else-if="form.type === 'GOTIFY'">
            <UFormField :label="$t('notifications.fields.serverUrl')" required>
              <UInput v-model="form.serverUrl" class="w-full" type="url" placeholder="https://gotify.example.com" />
            </UFormField>
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField :label="$t('notifications.fields.applicationToken')" required>
                <UInput v-model="form.token" autocomplete="off" class="w-full" type="password" />
              </UFormField>
              <UFormField :label="$t('notifications.fields.priority')">
                <USelect v-model="form.priority" class="w-full" :items="gotifyPriorityOptions" />
              </UFormField>
            </div>
          </template>

          <template v-else-if="form.type === 'NTFY'">
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField :label="$t('notifications.fields.serverUrl')">
                <UInput v-model="form.serverUrl" class="w-full" type="url" placeholder="https://ntfy.sh" />
              </UFormField>
              <UFormField :label="$t('notifications.fields.topic')" required>
                <UInput v-model="form.topic" class="w-full" />
              </UFormField>
              <UFormField :label="$t('notifications.fields.username')">
                <UInput v-model="form.username" autocomplete="username" class="w-full" />
              </UFormField>
              <UFormField :label="$t('notifications.fields.password')">
                <UInput v-model="form.password" autocomplete="new-password" class="w-full" type="password" />
              </UFormField>
              <UFormField :label="$t('notifications.fields.accessToken')">
                <UInput v-model="form.token" autocomplete="off" class="w-full" type="password" />
              </UFormField>
              <UFormField :label="$t('notifications.fields.priority')">
                <USelect v-model="form.ntfyPriority" class="w-full" :items="ntfyPriorityOptions" />
              </UFormField>
            </div>
          </template>

          <UFormField v-else-if="form.type === 'DISCORD'" :label="$t('notifications.fields.webhookUrl')" required>
            <UInput v-model="form.webhookUrl" autocomplete="off" class="w-full" type="url" />
          </UFormField>

          <UFormField
            v-else-if="form.type === 'CUSTOM_APPRISE'"
            :label="$t('notifications.fields.appriseUrl')"
            required
          >
            <UInput v-model="form.appriseUrl" autocomplete="off" class="w-full" type="password" />
          </UFormField>
        </div>

        <UAlert
          v-if="form.type === 'BROWSER_PUSH'"
          color="info"
          icon="i-lucide-monitor-smartphone"
          variant="subtle"
          :description="$t('notifications.channels.browserOwnerHint')"
        />

        <div class="flex justify-end border-t border-default pt-4">
          <UButton type="submit" :label="$t('common.save')" :loading="submitting" />
        </div>
      </UForm>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import type {
  NotificationChannel,
  NotificationChannelConfiguration,
  NotificationChannelType,
} from '~/types/api/resources';

const props = defineProps<{
  browserPushAvailable: boolean;
  channel: NotificationChannel | null;
  repositories: Array<{ id: string; name: string; owner: string }>;
}>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ saved: [] }>();
const { t } = useI18n();
const api = useEzRepoApi();
const submitting = ref(false);
const saveError = ref(false);
const replaceConfiguration = ref(false);
const form = reactive({
  appriseUrl: '',
  enabled: true,
  from: '',
  name: '',
  ntfyPriority: 'default' as 'min' | 'low' | 'default' | 'high' | 'max',
  password: '',
  port: 587,
  priority: 'normal' as 'low' | 'moderate' | 'normal' | 'high',
  recipients: '',
  repositoryId: '',
  security: 'STARTTLS' as 'NONE' | 'STARTTLS' | 'TLS',
  serverUrl: '',
  smtpHost: '',
  token: '',
  topic: '',
  type: 'EMAIL' as NotificationChannelType,
  username: '',
  webhookUrl: '',
});
const repositoryOptions = computed(() =>
  props.repositories.map((repository) => ({ label: `${repository.owner}/${repository.name}`, value: repository.id })),
);
const typeOptions = computed(() =>
  (['EMAIL', 'GOTIFY', 'NTFY', 'DISCORD', 'BROWSER_PUSH', 'CUSTOM_APPRISE'] as NotificationChannelType[]).map(
    (value) => ({
      disabled: value === 'BROWSER_PUSH' && !props.browserPushAvailable,
      label: t(`notifications.channelTypes.${value}`),
      value,
    }),
  ),
);
const securityOptions = computed(() =>
  (['NONE', 'STARTTLS', 'TLS'] as const).map((value) => ({ label: t(`notifications.security.${value}`), value })),
);
const gotifyPriorityOptions = ['low', 'moderate', 'normal', 'high'];
const ntfyPriorityOptions = ['min', 'low', 'default', 'high', 'max'];
const showConfiguration = computed(
  () => form.type !== 'BROWSER_PUSH' && (!props.channel || replaceConfiguration.value),
);

watch(open, (isOpen) => {
  if (!isOpen) return;
  Object.assign(form, {
    appriseUrl: '',
    enabled: props.channel?.enabled ?? true,
    from: '',
    name: props.channel?.name ?? '',
    ntfyPriority: 'default',
    password: '',
    port: 587,
    priority: 'normal',
    recipients: '',
    repositoryId: props.channel?.repositoryId ?? props.repositories[0]?.id ?? '',
    security: 'STARTTLS',
    serverUrl: '',
    smtpHost: '',
    token: '',
    topic: '',
    type: props.channel?.type ?? 'EMAIL',
    username: '',
    webhookUrl: '',
  });
  replaceConfiguration.value = false;
  saveError.value = false;
});

function configuration(): NotificationChannelConfiguration | undefined {
  if (!showConfiguration.value) return undefined;
  if (form.type === 'EMAIL') {
    return {
      from: form.from.trim(),
      password: form.password || undefined,
      port: form.port || undefined,
      recipients: form.recipients
        .split(/[\n,;]/)
        .map((value) => value.trim())
        .filter(Boolean),
      security: form.security,
      smtpHost: form.smtpHost.trim(),
      username: form.username.trim() || undefined,
    };
  }
  if (form.type === 'GOTIFY') return { priority: form.priority, serverUrl: form.serverUrl.trim(), token: form.token };
  if (form.type === 'NTFY') {
    return {
      password: form.password || undefined,
      priority: form.ntfyPriority,
      serverUrl: form.serverUrl.trim() || undefined,
      token: form.token || undefined,
      topic: form.topic.trim(),
      username: form.username.trim() || undefined,
    };
  }
  if (form.type === 'DISCORD') return { webhookUrl: form.webhookUrl.trim() };
  if (form.type === 'CUSTOM_APPRISE') return { url: form.appriseUrl.trim() };
  return undefined;
}

async function save(): Promise<void> {
  submitting.value = true;
  saveError.value = false;
  try {
    if (props.channel) {
      await api.notificationChannels.update(props.channel.id, {
        configuration: configuration(),
        enabled: form.enabled,
        name: form.name.trim(),
      });
    } else {
      await api.notificationChannels.create({
        configuration: configuration(),
        enabled: form.enabled,
        name: form.name.trim(),
        repositoryId: form.repositoryId,
        type: form.type,
      });
    }
    open.value = false;
    emit('saved');
  } catch {
    saveError.value = true;
  } finally {
    submitting.value = false;
  }
}
</script>
