<template>
  <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" :aria-label="title">
    <UCard v-for="metric in metrics" :key="metric.label" :ui="{ body: 'space-y-2' }">
      <div class="flex items-center justify-between gap-3">
        <p class="text-xs font-medium uppercase tracking-wide text-muted">{{ metric.label }}</p>
        <UIcon class="size-4 text-muted" :name="metric.icon" />
      </div>
      <USkeleton v-if="loading" class="h-8 w-20" />
      <p v-else class="text-2xl font-semibold tabular-nums">{{ metric.value }}</p>
    </UCard>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  loading: boolean;
  metrics: Array<{ icon: string; label: string; value: string }>;
  title: string;
}>();
</script>
