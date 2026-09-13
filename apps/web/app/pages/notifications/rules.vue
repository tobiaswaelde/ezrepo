<template>
  <div />
</template>

<script setup lang="ts">
definePageMeta({ middleware: () => navigateTo('/notifications', { replace: true }) });
</script>
