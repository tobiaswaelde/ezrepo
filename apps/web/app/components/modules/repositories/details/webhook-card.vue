<template>
  <UCard :ui="{ body: 'space-y-5' }">
    <template #header>
      <div>
        <h2 class="font-semibold">{{ $t('repositories.webhook.title') }}</h2>
        <p class="text-sm text-muted">{{ $t('repositories.webhook.description') }}</p>
      </div>
    </template>

    <USkeleton v-if="loading" class="h-48 w-full" />
    <UAlert
      v-else-if="loadError || !configuration"
      color="error"
      icon="i-lucide-circle-alert"
      variant="subtle"
      :title="$t('repositories.webhook.loadError')"
    />
    <div v-else class="space-y-5">
      <UAlert
        v-if="!publicCallbackUrl"
        color="warning"
        icon="i-lucide-triangle-alert"
        variant="subtle"
        :description="$t('repositories.webhook.publicUrlWarning')"
        :title="$t('repositories.webhook.publicUrlWarningTitle')"
      />
      <UAlert
        v-if="saveError"
        color="error"
        icon="i-lucide-circle-alert"
        variant="subtle"
        :title="$t('repositories.webhook.saveError')"
      />
      <UAlert
        v-else-if="saved"
        color="success"
        icon="i-lucide-circle-check"
        variant="subtle"
        :description="$t('repositories.webhook.savedDescription')"
        :title="$t('repositories.webhook.saved')"
      />

      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <p class="text-sm font-medium">{{ $t('repositories.webhook.status') }}</p>
          <UBadge class="mt-1" variant="subtle" :color="configuration.configured ? 'success' : 'warning'">
            {{
              $t(configuration.configured ? 'repositories.webhook.configured' : 'repositories.webhook.notConfigured')
            }}
          </UBadge>
        </div>
        <div>
          <p class="text-sm font-medium">{{ $t('repositories.webhook.lastDelivery') }}</p>
          <p class="mt-1 text-sm text-muted">{{ lastDelivery }}</p>
        </div>
      </div>

      <UFormField :help="$t('repositories.webhook.callbackUrlHelp')" :label="$t('repositories.webhook.callbackUrl')">
        <UInput class="w-full font-mono" readonly :model-value="configuration.callbackUrl">
          <template #trailing>
            <UButton
              color="neutral"
              size="xs"
              variant="ghost"
              :aria-label="$t('repositories.webhook.copyUrl')"
              :icon="urlCopied ? 'i-lucide-check' : 'i-lucide-copy'"
              @click="copy(configuration.callbackUrl, 'url')"
            />
          </template>
        </UInput>
      </UFormField>

      <UAlert
        color="neutral"
        icon="i-lucide-book-open"
        variant="subtle"
        :description="$t(`repositories.webhook.instructions.${configuration.providerType}`)"
        :title="$t('repositories.webhook.providerSetup')"
      />

      <UForm class="space-y-4" :state="form" @submit="save">
        <UFormField
          name="secret"
          :help="$t('repositories.webhook.secretHelp')"
          :label="$t('repositories.webhook.secret')"
          required
        >
          <UInput
            v-model="form.secret"
            autocomplete="new-password"
            class="w-full font-mono"
            :type="revealSecret ? 'text' : 'password'"
            :disabled="busy"
          >
            <template #trailing>
              <div class="flex items-center">
                <UButton
                  color="neutral"
                  size="xs"
                  variant="ghost"
                  :aria-label="$t(revealSecret ? 'repositories.webhook.hideSecret' : 'repositories.webhook.showSecret')"
                  :icon="revealSecret ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                  @click="revealSecret = !revealSecret"
                />
                <UButton
                  color="neutral"
                  size="xs"
                  variant="ghost"
                  :aria-label="$t('repositories.webhook.copySecret')"
                  :disabled="!form.secret"
                  :icon="secretCopied ? 'i-lucide-check' : 'i-lucide-copy'"
                  @click="copy(form.secret, 'secret')"
                />
              </div>
            </template>
          </UInput>
        </UFormField>

        <UButton
          color="neutral"
          icon="i-lucide-sparkles"
          variant="soft"
          :disabled="busy"
          :label="$t('repositories.webhook.generateSecret')"
          @click="generateSecret"
        />

        <UAlert
          v-if="configuration.configured"
          color="warning"
          icon="i-lucide-rotate-cw"
          variant="subtle"
          :description="$t('repositories.webhook.rotationWarning')"
          :title="$t('repositories.webhook.rotationWarningTitle')"
        />
        <UCheckbox
          v-if="configuration.configured"
          v-model="rotationConfirmed"
          :disabled="busy"
          :label="$t('repositories.webhook.rotationConfirm')"
        />

        <div class="flex flex-wrap justify-between gap-2 border-t border-default pt-4">
          <UButton
            v-if="configuration.configured"
            color="error"
            icon="i-lucide-trash-2"
            variant="soft"
            :label="$t('repositories.webhook.remove')"
            :loading="removing"
            :disabled="busy"
            @click="remove"
          />
          <span v-else />
          <UButton
            type="submit"
            icon="i-lucide-save"
            :disabled="!canSave"
            :label="$t(configuration.configured ? 'repositories.webhook.rotate' : 'repositories.webhook.save')"
            :loading="saving"
          />
        </div>
      </UForm>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import { useDateTime } from '~/composables/use-date-time';
import type { RepositoryWebhookConfiguration } from '~/types/api/resources';

const props = defineProps<{
  configuration?: RepositoryWebhookConfiguration;
  loadError: boolean;
  loading: boolean;
  repositoryId: string;
}>();
const emit = defineEmits<{ updated: [configuration: RepositoryWebhookConfiguration] }>();

const { t } = useI18n();
const api = useEzRepoApi();
const toast = useToast();
const { formatDateTime } = useDateTime();
const form = reactive({ secret: '' });
const revealSecret = ref(false);
const rotationConfirmed = ref(false);
const saveError = ref(false);
const saved = ref(false);
const saving = ref(false);
const removing = ref(false);
const secretCopied = ref(false);
const urlCopied = ref(false);
const busy = computed(() => saving.value || removing.value);
const canSave = computed(
  () => !busy.value && form.secret.trim().length > 0 && (!props.configuration?.configured || rotationConfirmed.value),
);
const lastDelivery = computed(() =>
  props.configuration?.lastDeliveryAt
    ? formatDateTime(props.configuration.lastDeliveryAt)
    : t('repositories.webhook.neverDelivered'),
);
const publicCallbackUrl = computed(() => {
  if (!props.configuration) return false;
  const callbackUrl = new URL(props.configuration.callbackUrl);
  return callbackUrl.protocol === 'https:' && !['127.0.0.1', '::1', 'localhost'].includes(callbackUrl.hostname);
});

watch(() => props.repositoryId, resetSensitiveState);

/** Create a high-entropy Base64 signing secret without contacting the server. */
function generateSecret(): void {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  form.secret = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
  revealSecret.value = true;
  saved.value = false;
  secretCopied.value = false;
}

/** Copy setup data while handling browsers that deny clipboard access. */
async function copy(value: string, target: 'secret' | 'url'): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    if (target === 'secret') secretCopied.value = true;
    else urlCopied.value = true;
  } catch {
    toast.add({ color: 'error', title: t('repositories.webhook.copyError') });
  }
}

/** Encrypt and persist a newly configured or rotated repository signing secret. */
async function save(): Promise<void> {
  if (!canSave.value) return;
  saving.value = true;
  saveError.value = false;
  saved.value = false;
  try {
    const { data } = await api.repositories.setWebhookSecret(props.repositoryId, form.secret.trim());
    saved.value = true;
    rotationConfirmed.value = false;
    emit('updated', data);
  } catch {
    saveError.value = true;
  } finally {
    saving.value = false;
  }
}

/** Remove the repository secret after explicit browser confirmation. */
async function remove(): Promise<void> {
  if (!props.configuration?.configured || !window.confirm(t('repositories.webhook.removeConfirm'))) return;
  removing.value = true;
  saveError.value = false;
  saved.value = false;
  try {
    await api.repositories.clearWebhookConfiguration(props.repositoryId);
    resetSensitiveState();
    emit('updated', { ...props.configuration, configured: false });
  } catch {
    saveError.value = true;
  } finally {
    removing.value = false;
  }
}

/** Remove plaintext secret material and transient UI state. */
function resetSensitiveState(): void {
  form.secret = '';
  revealSecret.value = false;
  rotationConfirmed.value = false;
  saveError.value = false;
  saved.value = false;
  secretCopied.value = false;
  urlCopied.value = false;
}
</script>
