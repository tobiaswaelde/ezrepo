<template>
  <UModal
    v-model:open="open"
    :description="$t('providers.webhook.description')"
    :dismissible="!saving"
    :title="$t('providers.webhook.title', { provider: provider?.displayName ?? '' })"
  >
    <template #body>
      <div v-if="provider && configuration" class="space-y-5">
        <UAlert
          v-if="!publicCallbackUrl"
          color="warning"
          icon="i-lucide-triangle-alert"
          variant="subtle"
          :description="$t('providers.webhook.publicUrlWarning')"
          :title="$t('providers.webhook.publicUrlWarningTitle')"
        />
        <UAlert
          v-if="saveError"
          color="error"
          icon="i-lucide-circle-alert"
          variant="subtle"
          :title="$t('providers.webhook.saveError')"
        />
        <UAlert
          v-else-if="saved"
          color="success"
          icon="i-lucide-circle-check"
          variant="subtle"
          :description="$t('providers.webhook.savedDescription')"
          :title="$t('providers.webhook.saved')"
        />

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <p class="text-sm font-medium">{{ $t('providers.webhook.status') }}</p>
            <UBadge class="mt-1" variant="subtle" :color="configuration.configured ? 'success' : 'warning'">
              {{ $t(configuration.configured ? 'providers.webhook.configured' : 'providers.webhook.notConfigured') }}
            </UBadge>
          </div>
          <div>
            <p class="text-sm font-medium">{{ $t('providers.webhook.lastDelivery') }}</p>
            <p class="mt-1 text-sm text-muted">{{ lastDelivery }}</p>
          </div>
        </div>

        <UFormField :help="$t('providers.webhook.callbackUrlHelp')" :label="$t('providers.webhook.callbackUrl')">
          <UInput class="w-full font-mono" readonly :model-value="configuration.callbackUrl">
            <template #trailing>
              <UButton
                color="neutral"
                size="xs"
                variant="ghost"
                :aria-label="$t('providers.webhook.copyUrl')"
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
          :description="$t(`providers.webhook.instructions.${provider.providerType}`)"
          :title="$t('providers.webhook.providerSetup')"
        />

        <UForm class="space-y-4" :state="form" @submit="save">
          <UFormField
            name="secret"
            :help="$t('providers.webhook.secretHelp')"
            :label="$t('providers.webhook.secret')"
            required
          >
            <UInput
              v-model="form.secret"
              autocomplete="new-password"
              class="w-full font-mono"
              :type="revealSecret ? 'text' : 'password'"
              :disabled="saving"
            >
              <template #trailing>
                <div class="flex items-center">
                  <UButton
                    color="neutral"
                    size="xs"
                    variant="ghost"
                    :aria-label="$t(revealSecret ? 'providers.webhook.hideSecret' : 'providers.webhook.showSecret')"
                    :icon="revealSecret ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                    @click="revealSecret = !revealSecret"
                  />
                  <UButton
                    color="neutral"
                    size="xs"
                    variant="ghost"
                    :aria-label="$t('providers.webhook.copySecret')"
                    :disabled="!form.secret"
                    :icon="secretCopied ? 'i-lucide-check' : 'i-lucide-copy'"
                    @click="copy(form.secret, 'secret')"
                  />
                </div>
              </template>
            </UInput>
          </UFormField>

          <div class="flex flex-wrap gap-2">
            <UButton
              color="neutral"
              icon="i-lucide-sparkles"
              variant="soft"
              :disabled="saving"
              :label="$t('providers.webhook.generateSecret')"
              @click="generateSecret"
            />
          </div>

          <UAlert
            v-if="configuration.configured"
            color="warning"
            icon="i-lucide-rotate-cw"
            variant="subtle"
            :description="$t('providers.webhook.rotationWarning')"
            :title="$t('providers.webhook.rotationWarningTitle')"
          />
          <UCheckbox
            v-if="configuration.configured"
            v-model="rotationConfirmed"
            :disabled="saving"
            :label="$t('providers.webhook.rotationConfirm')"
          />

          <div class="flex justify-end border-t border-default pt-4">
            <UButton
              type="submit"
              icon="i-lucide-save"
              :disabled="!canSave"
              :label="$t(configuration.configured ? 'providers.webhook.rotate' : 'providers.webhook.save')"
              :loading="saving"
            />
          </div>
        </UForm>
      </div>
      <UAlert
        v-else
        color="error"
        icon="i-lucide-circle-alert"
        variant="subtle"
        :title="$t('providers.webhook.loadError')"
      />
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import { useDateTime } from '~/composables/use-date-time';
import type { ProviderAccount, ProviderWebhookConfiguration } from '~/types/api/resources';

const props = defineProps<{
  configuration?: ProviderWebhookConfiguration;
  provider: ProviderAccount | null;
}>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ saved: [] }>();

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
const secretCopied = ref(false);
const urlCopied = ref(false);

const canSave = computed(
  () => !saving.value && form.secret.trim().length > 0 && (!props.configuration?.configured || rotationConfirmed.value),
);
const lastDelivery = computed(() =>
  props.configuration?.lastDeliveryAt
    ? formatDateTime(props.configuration.lastDeliveryAt)
    : t('providers.webhook.neverDelivered'),
);
const publicCallbackUrl = computed(() => {
  if (!props.configuration) return false;
  const callbackUrl = new URL(props.configuration.callbackUrl);
  return callbackUrl.protocol === 'https:' && !['127.0.0.1', '::1', 'localhost'].includes(callbackUrl.hostname);
});

watch(open, (isOpen) => {
  if (!isOpen) resetSensitiveState();
});

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
    toast.add({ color: 'error', title: t('providers.webhook.copyError') });
  }
}

/** Encrypt and persist a newly configured or rotated provider signing secret. */
async function save(): Promise<void> {
  if (!props.provider || !canSave.value) return;
  saving.value = true;
  saveError.value = false;
  saved.value = false;
  try {
    await api.providerAccounts.update(props.provider.id, { webhookSecret: form.secret.trim() });
    saved.value = true;
    emit('saved');
  } catch {
    saveError.value = true;
  } finally {
    saving.value = false;
  }
}

/** Remove plaintext secret material and transient UI state when the dialog closes. */
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
