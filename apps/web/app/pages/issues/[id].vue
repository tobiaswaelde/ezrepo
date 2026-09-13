<template><ModulesWorkItemsDetailPage :id="String(route.params.id)" kind="issue" /></template>

<script setup lang="ts">
definePageMeta({ fullWidth: true });

const route = useRoute();
</script>
