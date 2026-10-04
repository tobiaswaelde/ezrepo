<template>
  <LayoutPage
    full-width
    :breadcrumbs="[
      { icon: 'i-lucide-layout-dashboard', label: $t('layout.dashboard'), to: '/' },
      { icon: 'i-lucide-settings', label: $t('layout.settings') },
    ]"
    :description="$t('settings.description')"
    :title="$t('settings.title')"
  >
    <template #navigation>
      <UNavigationMenu highlight class="-mx-1 flex-1" :items="navigation" />
    </template>

    <div class="mx-auto w-full max-w-3xl" data-settings-page>
      <NuxtPage />
    </div>
  </LayoutPage>
</template>

<script setup lang="ts">
import type { NavigationMenuItem } from '#ui/types';
import { computed } from 'vue';

import { useAuthStore } from '~/store/auth';

definePageMeta({ fullWidth: true });

const { t } = useI18n();
const auth = useAuthStore();
const navigation = computed<NavigationMenuItem[][]>(() => [
  [
    {
      exact: true,
      icon: 'i-lucide-user-round',
      label: t('settings.tabs.general'),
      to: '/admin/settings',
    },
    {
      icon: 'i-lucide-key-round',
      label: t('settings.tabs.mcp'),
      to: '/admin/settings/mcp',
    },
    ...(auth.user?.role === 'SYSTEM_ADMIN'
      ? [
          {
            icon: 'i-lucide-shield-check',
            label: t('settings.tabs.authentication'),
            to: '/admin/settings/authentication',
          },
          {
            icon: 'i-lucide-settings-2',
            label: t('settings.tabs.system'),
            to: '/admin/settings/system',
          },
        ]
      : []),
  ],
]);

useHead({ title: computed(() => t('settings.title')) });
</script>
