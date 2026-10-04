<template>
  <div data-sidebar-footer class="flex w-full flex-col gap-1" :class="collapsed ? 'items-center' : 'items-start'">
    <UButton
      data-sidebar-footer-item
      to="https://github.com/tobiaswaelde/ezrepo"
      target="_blank"
      color="neutral"
      variant="ghost"
      icon="i-simple-icons-github"
      :aria-label="t('sidebar.github')"
      :title="t('sidebar.github')"
      :square="collapsed"
      :label="collapsed ? undefined : t('sidebar.githubLabel')"
      :class="collapsed ? undefined : 'w-full justify-start'"
    />
    <UButton
      data-sidebar-footer-item
      to="https://tobiaswaelde.github.io/ezrepo/"
      target="_blank"
      color="neutral"
      variant="ghost"
      icon="i-tabler-book-2"
      :aria-label="t('sidebar.docs')"
      :title="t('sidebar.docs')"
      :square="collapsed"
      :label="collapsed ? undefined : t('sidebar.docsLabel')"
      :class="collapsed ? undefined : 'w-full justify-start'"
    />
    <button
      v-if="!collapsed"
      data-sidebar-footer-item
      type="button"
      class="flex w-full items-center justify-center gap-1.5 rounded-md px-1.5 py-1 font-mono text-xs text-muted transition-colors hover:bg-elevated hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
      :aria-label="updateAvailable ? `${t('changelog.open')}: ${t('changelog.update')}` : t('changelog.open')"
      @click="changelogOpen = true"
    >
      v{{ appVersion }}
      <span v-if="updateAvailable" data-update-indicator class="size-2 rounded-full bg-success" aria-hidden="true" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { defineProps, onMounted } from 'vue';

import { useVersionCheck } from '~/composables/app/version-check';

defineProps<{
  collapsed: boolean;
}>();

const { t } = useI18n();
const changelogOpen = useState('changelog-open', () => false);
const { current: appVersion, load: loadVersion, updateAvailable } = useVersionCheck();

onMounted(loadVersion);
</script>
