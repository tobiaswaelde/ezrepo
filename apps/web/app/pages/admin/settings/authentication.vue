<template>
  <ModulesSettingsOidcCard />
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin' });

const { t } = useI18n();
useHead({ title: t('settings.tabs.authentication') });
</script>
