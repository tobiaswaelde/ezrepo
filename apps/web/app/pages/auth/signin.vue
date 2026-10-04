<template>
  <div class="space-y-6">
    <div class="space-y-1">
      <h1 class="text-xl font-semibold">{{ $t('auth.signIn') }}</h1>
      <p class="text-sm text-muted">{{ $t('auth.signInDescription') }}</p>
    </div>

    <UForm class="space-y-5" :schema="signInRequestSchema" :state="credentials" @submit="signIn">
      <UAlert
        v-if="errorMessage"
        color="error"
        icon="i-lucide-circle-alert"
        variant="subtle"
        :description="errorMessage"
      />

      <UFormField name="username" :label="$t('auth.username')" required>
        <UInput
          v-model="credentials.username"
          autocomplete="username"
          class="w-full"
          icon="i-lucide-user"
          :placeholder="$t('auth.usernamePlaceholder')"
        />
      </UFormField>

      <UFormField name="password" :label="$t('auth.password')" required>
        <UInput
          v-model="credentials.password"
          autocomplete="current-password"
          class="w-full"
          icon="i-lucide-key-round"
          type="password"
          :placeholder="$t('auth.passwordPlaceholder')"
        />
      </UFormField>

      <UButton block type="submit" :label="$t('auth.signIn')" :loading="isSubmitting" />
    </UForm>

    <template v-if="oidcStatus?.enabled">
      <div class="flex items-center gap-3" aria-hidden="true">
        <USeparator class="flex-1" />
        <span class="text-xs font-medium text-muted uppercase">{{ $t('auth.oidc.or') }}</span>
        <USeparator class="flex-1" />
      </div>
      <UButton
        block
        color="neutral"
        icon="i-lucide-log-in"
        variant="outline"
        :href="oidcStartUrl"
        :label="
          oidcStatus.providerName
            ? $t('auth.oidc.signInWith', { provider: oidcStatus.providerName })
            : $t('auth.oidc.signIn')
        "
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui';
import { computed, onMounted, reactive, ref } from 'vue';

import { useApi } from '~/composables/api/api';
import { useUnsavedChangesGuard } from '~/composables/use-unsaved-changes-guard';
import { useAuthStore } from '~/store/auth';
import { signInRequestSchema, type OidcStatus, type SignInRequest } from '~/types/api/auth';

definePageMeta({ layout: 'auth' });

const auth = useAuthStore();
const config = useRuntimeConfig();
const route = useRoute();
const { t } = useI18n();
const credentials = reactive({ password: '', username: '' });
const errorMessage = ref<string | null>(null);
const isSubmitting = ref(false);
const { reset } = useUnsavedChangesGuard(credentials);
const oidcStatus = ref<OidcStatus | null>(null);
const oidcStartUrl = computed(() => `${config.public.apiBaseUrl.replace(/\/$/, '')}/auth/oidc/start`);
const oidcErrors = new Set([
  'oidc_not_configured',
  'oidc_invalid_request',
  'oidc_transaction_invalid',
  'oidc_provider_error',
  'oidc_token_invalid',
  'oidc_access_denied',
  'oidc_unavailable',
]);

useHead({ title: t('auth.signIn') });

onMounted(async () => {
  const code = typeof route.query.oidc_error === 'string' ? route.query.oidc_error : null;
  if (code && oidcErrors.has(code)) errorMessage.value = t(`auth.oidc.errors.${code}`);
  try {
    oidcStatus.value = (await useApi().get<OidcStatus>('/auth/oidc/status')).data;
  } catch {
    oidcStatus.value = null;
  }
});

/** Validate and submit local credentials, then open the authenticated dashboard. */
async function signIn(event: FormSubmitEvent<SignInRequest>): Promise<void> {
  errorMessage.value = null;

  isSubmitting.value = true;
  try {
    await auth.signIn(event.data.username, event.data.password);
    Object.assign(credentials, { password: '', username: '' });
    reset();
    await navigateTo('/');
  } catch {
    errorMessage.value = t('auth.invalidCredentials');
  } finally {
    isSubmitting.value = false;
  }
}
</script>
