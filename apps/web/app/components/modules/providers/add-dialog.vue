<template>
  <UModal
    v-model:open="open"
    :description="$t('providers.connectDescription')"
    :dismissible="!busy"
    :title="$t('providers.addDialogTitle')"
  >
    <template #body>
      <UAlert
        v-if="connectionError"
        color="error"
        icon="i-lucide-circle-alert"
        variant="subtle"
        :title="$t(usePat ? 'providers.credentialsError' : 'providers.oauthError')"
      />
      <UForm class="mt-4 space-y-6" :schema="providerFormSchema" :state="form" @submit="addProvider">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField name="displayName" :label="$t('providers.name')">
            <UInput v-model="form.displayName" class="w-full" :placeholder="$t('providers.namePlaceholder')" />
          </UFormField>
          <UFormField name="providerType" :label="$t('providers.type')">
            <EnumsProviderTypeSelect
              v-model="form.providerType"
              class="w-full"
              :placeholder="$t('providers.typePlaceholder')"
            />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField v-if="oauthAvailable" :label="$t('providers.authentication')">
            <USelect v-model="authenticationMethod" class="w-full" :items="authenticationOptions" />
          </UFormField>
          <UFormField v-if="usePat" name="accessToken" :label="$t('providers.accessToken')">
            <UInput
              v-model="form.accessToken"
              autocomplete="off"
              class="w-full"
              type="password"
              :placeholder="$t('providers.accessTokenPlaceholder')"
            />
          </UFormField>
          <UFormField name="baseUrl" :label="$t('providers.baseUrl')" :required="requiresBaseUrl">
            <UInput
              v-model="form.baseUrl"
              autocomplete="url"
              class="w-full"
              inputmode="url"
              type="url"
              :placeholder="$t('providers.baseUrlPlaceholder')"
            />
          </UFormField>
        </div>

        <div class="flex justify-end border-t border-default pt-4">
          <UButton
            type="submit"
            :disabled="busy"
            :label="usePat ? $t('providers.addAndVerify') : $t('providers.connect')"
            :loading="busy"
          />
        </div>
      </UForm>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

import { defineEmits, defineModel } from 'vue';
import { useEzRepoApi } from '~/composables/api/ezrepo-api';
import { useUnsavedChangesGuard } from '~/composables/use-unsaved-changes-guard';
import { providerOAuthFormSchema, providerPatFormSchema, type ProviderType } from '~/types/api/resources';

type AuthenticationMethod = 'OAUTH' | 'PAT';

const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{
  created: [];
}>();

const { t } = useI18n();
const api = useEzRepoApi();
const submitting = ref(false);
const loadingAuthenticationOptions = ref(false);
const connectionError = ref(false);
const oauthProviderTypes = ref<ProviderType[]>([]);
const authenticationMethod = ref<AuthenticationMethod>('PAT');
const form = reactive({ accessToken: '', baseUrl: '', displayName: '', providerType: 'GITHUB' as ProviderType });
const { reset: resetDirtyState } = useUnsavedChangesGuard(form);
const oauthAvailable = computed(() => oauthProviderTypes.value.includes(form.providerType));
const usePat = computed(() => !oauthAvailable.value || authenticationMethod.value === 'PAT');
const requiresBaseUrl = computed(() => form.providerType === 'GITEA');
const providerFormSchema = computed(() => (usePat.value ? providerPatFormSchema : providerOAuthFormSchema));
const busy = computed(() => submitting.value || loadingAuthenticationOptions.value);
const authenticationOptions = computed(() => [
  { icon: 'i-tabler-key', label: t('providers.authenticationOAuth'), value: 'OAUTH' },
  { icon: 'i-tabler-password', label: t('providers.authenticationPat'), value: 'PAT' },
]);

watch(open, async (isOpen) => {
  if (!isOpen) return;

  Object.assign(form, { accessToken: '', baseUrl: '', displayName: '', providerType: 'GITHUB' });
  connectionError.value = false;
  resetDirtyState();
  loadingAuthenticationOptions.value = true;

  try {
    const { data } = await api.providerAccounts.authenticationOptions();
    oauthProviderTypes.value = data.oauthProviderTypes;
    authenticationMethod.value = oauthProviderTypes.value.includes('GITHUB') ? 'OAUTH' : 'PAT';
  } catch {
    oauthProviderTypes.value = [];
    authenticationMethod.value = 'PAT';
  } finally {
    loadingAuthenticationOptions.value = false;
  }
});

/** Validate and persist a PAT account, or begin the provider-controlled OAuth flow. */
async function addProvider(): Promise<void> {
  submitting.value = true;
  connectionError.value = false;
  try {
    if (usePat.value) {
      await api.providerAccounts.create({
        ...form,
        baseUrl: form.baseUrl.trim() || undefined,
      });
      open.value = false;
      resetDirtyState();
      emit('created');
      return;
    }

    const { data } = await api.providerAccounts.authorize({
      baseUrl: form.baseUrl.trim() || undefined,
      displayName: form.displayName,
      providerType: form.providerType,
    });
    resetDirtyState();
    window.location.assign(data.authorizationUrl);
  } catch {
    connectionError.value = true;
  } finally {
    submitting.value = false;
  }
}
</script>
