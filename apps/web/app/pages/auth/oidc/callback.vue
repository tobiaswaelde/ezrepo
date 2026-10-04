<template>
  <div class="space-y-4 text-center">
    <UIcon class="mx-auto size-8 animate-spin text-primary" name="i-lucide-loader-circle" />
    <h1 class="text-xl font-semibold">{{ $t('auth.oidc.completing') }}</h1>
    <p class="text-sm text-muted">{{ $t('auth.oidc.completingDescription') }}</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';

import { useAuthStore } from '~/store/auth';

interface OidcHandoffWindow extends Window {
  __ezrepoOidcHandoffFragment?: string;
}

definePageMeta({ layout: 'auth' });

const auth = useAuthStore();
const router = useRouter();
const { t } = useI18n();
const handoffWindow = import.meta.client ? (window as OidcHandoffWindow) : null;
const rawFragment =
  handoffWindow?.__ezrepoOidcHandoffFragment ?? (import.meta.client ? window.location.hash.slice(1) : '');
const fragment = new URLSearchParams(rawFragment);
const code = fragment.get('code');
const error = fragment.get('error');

if (handoffWindow) {
  delete handoffWindow.__ezrepoOidcHandoffFragment;
  window.history.replaceState({}, '', '/auth/oidc/callback');
}

useHead({ title: t('auth.oidc.completing') });

onMounted(async () => {
  if (!code || error) {
    await router.replace({ path: '/auth/signin', query: { oidc_error: error ?? 'oidc_invalid_request' } });
    return;
  }

  try {
    const returnTo = await auth.exchangeOidcCode(code);
    await router.replace(returnTo);
  } catch {
    await router.replace({ path: '/auth/signin', query: { oidc_error: 'oidc_transaction_invalid' } });
  }
});
</script>
