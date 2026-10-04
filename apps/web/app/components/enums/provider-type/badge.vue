<template>
  <UBadge :color="color" :icon="icon" :label="label" :size="size" :variant="variant" />
</template>

<script setup lang="ts">
import type { BadgeProps } from '#ui/types';

import { defineProps } from 'vue';
import { useProviderType } from '~/composables/enums/provider-type';
import type { ProviderType } from '~/types/api/resources';

const props = defineProps<{
  size?: BadgeProps['size'];
  value: ProviderType;
  variant?: BadgeProps['variant'];
}>();

const value = toRef(props, 'value');
const { color, icon, label } = useProviderType(value);
</script>
