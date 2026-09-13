<template><ModulesWorkItemsTablePage kind="issue" /></template>

<script setup lang="ts">
definePageMeta({ fullWidth: true });

const { t } = useI18n();
useHead({ title: computed(() => t('issues.title')) });
</script>
