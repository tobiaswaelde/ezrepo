<template>
  <div class="flex max-w-80 flex-wrap gap-1">
    <UBadge
      v-for="label in labels"
      :key="label.name"
      color="neutral"
      size="sm"
      variant="subtle"
      :style="label.color ? { borderColor: `#${label.color}` } : undefined"
    >
      {{ label.name }}
    </UBadge>
  </div>
</template>

<script setup lang="ts">
import type { WorkItemLabel } from '~/types/api/resources';

defineProps<{ labels: WorkItemLabel[] }>();
</script>
