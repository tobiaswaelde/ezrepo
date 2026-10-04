<template>
  <UAvatar :alt="identityLabel" :size="size" :src="source" :text="initials" />
</template>

<script setup lang="ts">
import type { AvatarProps } from '#ui/components/Avatar.vue';
import { computed, ref, watch } from 'vue';

import { defineProps, withDefaults } from 'vue';
import { useAvatarImages } from '~/composables/app/avatar-images';
import { getUserIdentityLabel, getUserInitials } from '~/utils/user-identity';

const props = withDefaults(
  defineProps<{
    avatarUpdatedAt?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    size?: AvatarProps['size'];
    userId: string;
    username: string;
  }>(),
  { size: 'md' },
);

const { load } = useAvatarImages();
const source = ref<string>();
const identityLabel = computed(() => getUserIdentityLabel(props));
const initials = computed(() => getUserInitials(props));
let loadSequence = 0;

watch(
  () => [props.userId, props.avatarUpdatedAt] as const,
  async ([userId, avatarUpdatedAt]) => {
    const sequence = ++loadSequence;
    const loadedSource = await load(userId, avatarUpdatedAt);
    if (sequence === loadSequence) source.value = loadedSource;
  },
  { immediate: true },
);
</script>
