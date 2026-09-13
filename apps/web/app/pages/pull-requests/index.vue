<template><ModulesWorkItemsTablePage kind="pull-request" /></template>

<script setup lang="ts">
definePageMeta({ fullWidth: true });

const { t } = useI18n();
useHead({ title: computed(() => t('pullRequests.title')) });
</script>
