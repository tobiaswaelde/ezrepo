<template>
  <LayoutPage
    full-width
    :breadcrumbs="[
      { icon: 'i-lucide-layout-dashboard', label: $t('layout.dashboard'), to: '/' },
      { icon: 'i-lucide-bell', label: $t('layout.notifications') },
    ]"
    :padded="false"
    :title="$t('notifications.title')"
  >
    <template #navigation>
      <UNavigationMenu highlight class="-mx-1 flex-1" :items="navigation" />
    </template>

    <NuxtPage />
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
      icon: 'i-lucide-radio-tower',
      label: t('notifications.tabs.channels'),
      to: '/notifications',
    },
    ...(auth.user?.role !== 'SYSTEM_ADMIN'
      ? []
      : [{ icon: 'i-lucide-history', label: t('notifications.tabs.history'), to: '/notifications/history' }]),
  ],
]);

useHead({ title: computed(() => t('notifications.title')) });
</script>
