<template>
  <UCard :ui="{ body: 'space-y-6' }">
    <template #header>
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="font-semibold">{{ $t('settings.oidc.title') }}</h2>
          <p class="text-sm text-muted">{{ $t('settings.oidc.description') }}</p>
        </div>
        <UBadge variant="subtle" :color="config?.enabled ? 'success' : 'neutral'">
          {{ config?.enabled ? $t('settings.oidc.enabled') : $t('settings.oidc.disabled') }}
        </UBadge>
      </div>
    </template>

    <UAlert
      v-if="loadError"
      color="error"
      icon="i-lucide-circle-alert"
      variant="subtle"
      :title="$t('settings.oidc.loadError')"
    />
    <div v-else-if="loading" class="space-y-4">
      <USkeleton class="h-12 w-full" />
      <USkeleton class="h-24 w-full" />
      <USkeleton class="h-24 w-full" />
    </div>
    <UForm v-else class="space-y-6" :state="form" @submit="save">
      <UAlert
        v-if="config?.clientSecretConfigured && !config.secretDecryptable"
        color="error"
        icon="i-lucide-shield-alert"
        variant="subtle"
        :title="$t('settings.oidc.secretUnavailable')"
      />
      <UAlert
        v-if="saveError"
        color="error"
        icon="i-lucide-circle-alert"
        variant="subtle"
        :title="$t('settings.oidc.saveError')"
      />
      <UAlert
        v-else-if="saved"
        color="success"
        icon="i-lucide-circle-check"
        variant="subtle"
        :title="$t('settings.oidc.saved')"
      />

      <div class="flex items-center justify-between gap-4 rounded-md bg-elevated p-4">
        <div>
          <p class="font-medium">{{ $t('settings.oidc.enable') }}</p>
          <p class="text-sm text-muted">{{ $t('settings.oidc.enableHelp') }}</p>
        </div>
        <USwitch v-model="form.enabled" :disabled="saving" />
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField :label="$t('settings.oidc.providerName')">
          <UInput v-model="form.providerName" class="w-full" :disabled="saving" />
        </UFormField>
        <UFormField :label="$t('settings.oidc.clientId')" required>
          <UInput v-model="form.clientId" class="w-full" autocomplete="off" :disabled="saving" />
        </UFormField>
      </div>

      <UFormField :help="$t('settings.oidc.issuerHelp')" :label="$t('settings.oidc.issuer')" required>
        <UInput
          v-model="form.issuer"
          class="w-full"
          placeholder="https://auth.example.com/application/o/ezrepo/"
          :disabled="saving"
        />
      </UFormField>

      <UFormField :help="$t('settings.oidc.callbackHelp')" :label="$t('settings.oidc.callbackUrl')">
        <UInput class="w-full font-mono" :model-value="config?.callbackUrl" readonly>
          <template #trailing>
            <UButton
              type="button"
              color="neutral"
              icon="i-lucide-copy"
              size="xs"
              variant="ghost"
              :aria-label="$t('settings.oidc.copy')"
              @click="copyCallback"
            />
          </template>
        </UInput>
      </UFormField>

      <UFormField :help="secretHelp" :label="$t('settings.oidc.clientSecret')">
        <UInput
          v-model="form.clientSecret"
          class="w-full"
          autocomplete="new-password"
          type="password"
          :disabled="saving || form.clientSecretClear"
        />
      </UFormField>
      <UCheckbox
        v-model="form.clientSecretClear"
        :disabled="saving || !config?.clientSecretConfigured"
        :label="$t('settings.oidc.clearSecret')"
      />

      <UFormField :help="$t('settings.oidc.scopesHelp')" :label="$t('settings.oidc.scopes')">
        <UInput v-model="form.scopes" class="w-full" :disabled="saving" />
      </UFormField>
      <UFormField :help="$t('settings.oidc.groupsClaimHelp')" :label="$t('settings.oidc.groupsClaim')">
        <UInput v-model="form.groupsClaim" class="w-full" :disabled="saving" />
      </UFormField>

      <div class="grid gap-4 lg:grid-cols-3">
        <UFormField :label="$t('settings.oidc.systemAdministratorGroups')">
          <UTextarea v-model="form.systemAdministratorGroups" class="w-full" :disabled="saving" :rows="4" />
        </UFormField>
        <UFormField :label="$t('settings.oidc.managerGroups')">
          <UTextarea v-model="form.managerGroups" class="w-full" :disabled="saving" :rows="4" />
        </UFormField>
        <UFormField :label="$t('settings.oidc.viewerGroups')">
          <UTextarea v-model="form.viewerGroups" class="w-full" :disabled="saving" :rows="4" />
        </UFormField>
      </div>

      <div v-if="config?.observedGroups.length" class="space-y-2">
        <p class="text-sm font-medium">{{ $t('settings.oidc.observedGroups') }}</p>
        <div class="flex flex-wrap gap-2">
          <UBadge v-for="group in config.observedGroups" :key="group" color="neutral" variant="subtle">
            {{ group }}
          </UBadge>
        </div>
      </div>

      <UCheckbox
        v-model="form.allowUnmatchedViewer"
        :disabled="saving"
        :label="$t('settings.oidc.allowUnmatchedViewer')"
      />
      <UCheckbox v-model="form.allowHttpIssuer" :disabled="saving" :label="$t('settings.oidc.allowHttpIssuer')" />
      <UAlert
        v-if="form.allowHttpIssuer"
        color="warning"
        icon="i-lucide-triangle-alert"
        variant="subtle"
        :title="$t('settings.oidc.httpWarning')"
      />

      <UAlert
        v-if="checkResult"
        variant="subtle"
        :color="checkResult.ok ? 'success' : 'error'"
        :icon="checkResult.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'"
        :title="checkResult.ok ? $t('settings.oidc.checkSuccess') : $t('settings.oidc.checkFailed')"
        :description="checkResult.ok ? checkDetails : checkResult.code"
      />

      <div class="flex flex-wrap justify-end gap-2 border-t border-default pt-6">
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          :disabled="dirty"
          :label="$t('settings.oidc.check')"
          :loading="checking"
          @click="check"
        />
        <UButton type="submit" icon="i-lucide-save" :label="$t('settings.save')" :loading="saving" />
      </div>
    </UForm>
  </UCard>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';

import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import type { OidcCheckResult, OidcConfig, UpdateOidcConfig } from '~/types/api/auth';

const api = useEzRepoApi();
const { t } = useI18n();
const toast = useToast();
const config = ref<OidcConfig | null>(null);
const loading = ref(true);
const loadError = ref(false);
const saving = ref(false);
const saveError = ref(false);
const saved = ref(false);
const checking = ref(false);
const checkResult = ref<OidcCheckResult | null>(null);
const baseline = ref('');
const form = reactive({
  allowHttpIssuer: false,
  allowUnmatchedViewer: false,
  clientId: '',
  clientSecret: '',
  clientSecretClear: false,
  enabled: false,
  groupsClaim: 'groups',
  issuer: '',
  managerGroups: '',
  providerName: '',
  scopes: 'openid profile email',
  systemAdministratorGroups: '',
  viewerGroups: '',
});
const serialized = computed(() => JSON.stringify(form));
const dirty = computed(() => serialized.value !== baseline.value);
const secretHelp = computed(() =>
  config.value?.clientSecretConfigured ? t('settings.oidc.secretConfigured') : t('settings.oidc.secretOptional'),
);
const checkDetails = computed(() =>
  checkResult.value?.ok
    ? [checkResult.value.idTokenAlgorithm, checkResult.value.tokenEndpointAuthenticationMethod]
        .filter(Boolean)
        .join(' · ')
    : '',
);

function apply(value: OidcConfig): void {
  config.value = value;
  Object.assign(form, {
    allowHttpIssuer: value.allowHttpIssuer,
    allowUnmatchedViewer: value.allowUnmatchedViewer,
    clientId: value.clientId ?? '',
    clientSecret: '',
    clientSecretClear: false,
    enabled: value.enabled,
    groupsClaim: value.groupsClaim,
    issuer: value.issuer ?? '',
    managerGroups: value.managerGroups.join('\n'),
    providerName: value.providerName ?? '',
    scopes: value.scopes.join(' '),
    systemAdministratorGroups: value.systemAdministratorGroups.join('\n'),
    viewerGroups: value.viewerGroups.join('\n'),
  });
  baseline.value = JSON.stringify(form);
}

function lines(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = false;
  try {
    apply((await api.oidc.config()).data);
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  saving.value = true;
  saveError.value = false;
  saved.value = false;
  checkResult.value = null;
  const input: UpdateOidcConfig = {
    allowHttpIssuer: form.allowHttpIssuer,
    allowUnmatchedViewer: form.allowUnmatchedViewer,
    clientId: form.clientId.trim() || null,
    enabled: form.enabled,
    groupsClaim: form.groupsClaim.trim(),
    issuer: form.issuer.trim() || null,
    managerGroups: lines(form.managerGroups),
    providerName: form.providerName.trim() || null,
    scopes: form.scopes.split(/\s+/).filter(Boolean),
    systemAdministratorGroups: lines(form.systemAdministratorGroups),
    viewerGroups: lines(form.viewerGroups),
  };
  if (form.clientSecretClear) input.clientSecretClear = true;
  else if (form.clientSecret) input.clientSecret = form.clientSecret;
  try {
    apply((await api.oidc.update(input)).data);
    saved.value = true;
  } catch {
    saveError.value = true;
  } finally {
    saving.value = false;
  }
}

async function check(): Promise<void> {
  checking.value = true;
  checkResult.value = null;
  try {
    checkResult.value = (await api.oidc.check()).data;
  } catch {
    checkResult.value = { code: 'request_failed', ok: false };
  } finally {
    checking.value = false;
  }
}

async function copyCallback(): Promise<void> {
  if (!config.value?.callbackUrl) return;
  await navigator.clipboard.writeText(config.value.callbackUrl);
  toast.add({ color: 'success', title: t('settings.oidc.copied') });
}

onMounted(() => void load());
</script>
