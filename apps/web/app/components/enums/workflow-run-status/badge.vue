<template>
  <UBadge variant="subtle" :color="getColor(status)">
    {{ $t(`workflowStatus.${status}`) }}
  </UBadge>
</template>

<script setup lang="ts">
import { defineProps } from 'vue';
import { useWorkflowRunStatus } from '~/composables/enums/workflow-run-status';
import type { WorkflowRunStatus } from '~/types/api/resources';

defineProps<{
  status: WorkflowRunStatus;
}>();

const { getColor } = useWorkflowRunStatus();
</script>
