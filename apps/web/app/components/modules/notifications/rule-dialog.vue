<template>
  <UModal
    v-model:open="open"
    :dismissible="!submitting"
    :title="$t(rule ? 'notifications.rulesView.editTitle' : 'notifications.rulesView.createTitle')"
  >
    <template #body>
      <UAlert
        v-if="saveError"
        class="mb-4"
        color="error"
        icon="i-lucide-circle-alert"
        variant="subtle"
        :title="$t('notifications.rulesView.saveError')"
      />
      <UForm class="space-y-5" :state="form" @submit="save">
        <UFormField :label="$t('notifications.fields.repository')" required>
          <USelect v-model="form.repositoryId" class="w-full" :disabled="Boolean(rule)" :items="repositoryOptions" />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="$t('notifications.fields.workflowPattern')" required>
            <UInput v-model="form.workflowPattern" class="w-full" placeholder="*" />
          </UFormField>
          <UFormField :label="$t('notifications.fields.event')" required>
            <USelect v-model="form.outcome" class="w-full" :items="outcomeOptions" />
          </UFormField>
        </div>
        <UFormField :label="$t('notifications.fields.channels')" required>
          <USelectMenu
            v-model="form.channelIds"
            multiple
            class="w-full"
            value-key="value"
            :items="channelOptions"
            :loading="loadingChannels"
          />
        </UFormField>
        <UFormField :label="$t('notifications.fields.enabled')"><USwitch v-model="form.enabled" /></UFormField>
        <div class="flex justify-end border-t border-default pt-4">
          <UButton
            type="submit"
            :disabled="form.channelIds.length === 0"
            :label="$t('common.save')"
            :loading="submitting"
          />
        </div>
      </UForm>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import type { NotificationChannel, NotificationRule, NotificationRuleOutcome } from '~/types/api/resources';

const props = defineProps<{
  repositories: Array<{ id: string; name: string; owner: string }>;
  rule: NotificationRule | null;
}>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ saved: [] }>();
const { t } = useI18n();
const api = useEzRepoApi();
const channels = ref<NotificationChannel[]>([]);
const loadingChannels = ref(false);
const saveError = ref(false);
const submitting = ref(false);
const form = reactive({
  channelIds: [] as string[],
  enabled: true,
  outcome: 'FAILED' as NotificationRuleOutcome,
  repositoryId: '',
  workflowPattern: '*',
});
const repositoryOptions = computed(() =>
  props.repositories.map((repository) => ({ label: `${repository.owner}/${repository.name}`, value: repository.id })),
);
const channelOptions = computed(() => channels.value.map((channel) => ({ label: channel.name, value: channel.id })));
const outcomeOptions = computed(() =>
  (['SUCCESS', 'FAILED'] as NotificationRuleOutcome[]).map((value) => ({ label: t(`workflowStatus.${value}`), value })),
);

watch(open, async (isOpen) => {
  if (!isOpen) return;
  Object.assign(form, {
    channelIds: [...(props.rule?.channelIds ?? [])],
    enabled: props.rule?.enabled ?? true,
    outcome: props.rule?.outcome ?? 'FAILED',
    repositoryId: props.rule?.repositoryId ?? props.repositories[0]?.id ?? '',
    workflowPattern: props.rule?.workflowPattern ?? '*',
  });
  saveError.value = false;
  await loadChannels();
});
watch(
  () => form.repositoryId,
  () => {
    if (open.value && !props.rule) void loadChannels();
  },
);

async function loadChannels(): Promise<void> {
  if (!form.repositoryId) return;
  loadingChannels.value = true;
  try {
    channels.value = (await api.notificationChannels.list(form.repositoryId)).data;
  } finally {
    loadingChannels.value = false;
  }
}

async function save(): Promise<void> {
  submitting.value = true;
  saveError.value = false;
  try {
    const input = {
      channelIds: [...form.channelIds],
      enabled: form.enabled,
      outcome: form.outcome,
      workflowPattern: form.workflowPattern.trim(),
    };
    if (props.rule) await api.notificationRules.update(props.rule.id, input);
    else await api.notificationRules.create({ ...input, repositoryId: form.repositoryId });
    open.value = false;
    emit('saved');
  } catch {
    saveError.value = true;
  } finally {
    submitting.value = false;
  }
}
</script>
