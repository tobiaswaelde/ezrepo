<template><ModulesWorkItemsDetailPage :id="String(route.params.id)" kind="pull-request" /></template>

<script setup lang="ts">
definePageMeta({ fullWidth: true });

const route = useRoute();
</script>
