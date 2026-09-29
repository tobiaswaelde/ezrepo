<template><ModulesSecurityAlertsDetailPage :id="String(route.params.id)" /></template>
<script setup lang="ts">
const route = useRoute();
definePageMeta({ fullWidth: true, middleware: 'manager' });
</script>
