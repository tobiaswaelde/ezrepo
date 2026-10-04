<template>
  <div class="space-y-6">
    <UAlert
      v-if="auth.user?.authProvider === 'OIDC'"
      color="info"
      icon="i-lucide-shield-check"
      variant="subtle"
      :title="$t('settings.oidcManagedTitle')"
      :description="$t('settings.oidcManagedDescription')"
    />
    <ModulesSettingsProfileCard v-else />
    <ModulesSettingsAvatarCard />
    <ModulesSettingsPasswordCard v-if="auth.user?.authProvider !== 'OIDC'" />
  </div>
</template>

<script setup lang="ts">
import { useAuthStore } from '~/store/auth';

const auth = useAuthStore();
</script>
