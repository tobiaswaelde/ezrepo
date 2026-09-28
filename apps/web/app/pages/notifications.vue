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
    <NuxtPage />
  </LayoutPage>
</template>

<script setup lang="ts">
import { computed } from 'vue';

definePageMeta({ fullWidth: true });

const { t } = useI18n();

useHead({ title: computed(() => t('notifications.title')) });
</script>
