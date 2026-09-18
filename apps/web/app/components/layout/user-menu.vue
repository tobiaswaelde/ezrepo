<template>
  <UDropdownMenu
    v-if="auth.user"
    :content="{ onCloseAutoFocus: openShortcutsAfterMenu }"
    :items="items"
    :ui="{ content: 'w-64' }"
  >
    <UButton
      ref="menuTrigger"
      class="gap-2"
      color="neutral"
      variant="ghost"
      :aria-label="getUserIdentityLabel(auth.user)"
      :disabled="signingOut"
      :loading="signingOut"
    >
      <CommonUserAvatar
        size="2xs"
        :avatar-updated-at="auth.user.avatarUpdatedAt"
        :first-name="auth.user.firstName"
        :last-name="auth.user.lastName"
        :user-id="auth.user.id"
        :username="auth.user.username"
      />
      <span class="hidden max-w-64 truncate text-sm sm:inline">{{ getUserIdentityLabel(auth.user) }}</span>
    </UButton>
  </UDropdownMenu>
</template>

<script setup lang="ts">
import type { DropdownMenuItem } from '#ui/types';

import { useLocales } from '~/composables/app/locales';
import { useShortcuts } from '~/composables/app/shortcuts';
import { useThemes } from '~/composables/app/themes';
import { useAuthStore } from '~/store/auth';
import { globalShortcuts } from '~/util/shortcuts';
import { getUserIdentityLabel } from '~/utils/user-identity';

const auth = useAuthStore();
const signingOut = ref(false);
const menuTrigger = useTemplateRef('menuTrigger');
const shortcutsRequested = ref(false);
const { open: shortcutsOpen } = useShortcuts();

/** Let the dropdown restore trigger focus before the dialog captures it. */
function openShortcutsAfterMenu(event: Event): void {
  if (!shortcutsRequested.value) return;
  event.preventDefault();
  menuTrigger.value?.$el?.focus();
  shortcutsRequested.value = false;
  void nextTick(() => {
    shortcutsOpen.value = true;
  });
}

const { t } = useI18n();
const { dropdownMenuItems: localeItems } = useLocales();
const { dropdownMenuItems: themeItems } = useThemes();

const items = computed<DropdownMenuItem[]>(() => [
  {
    icon: 'i-lucide-settings',
    label: t('layout.settings'),
    to: '/admin/settings',
  },
  { type: 'separator' },
  {
    children: localeItems.value,
    icon: 'i-tabler-language',
    label: t('layout.language'),
  },
  {
    children: themeItems.value,
    icon: 'i-tabler-palette',
    label: t('layout.theme'),
  },
  { type: 'separator' },
  {
    icon: 'i-tabler-keyboard',
    label: t('shortcuts.title'),
    kbds: [...globalShortcuts.find((shortcut) => shortcut.id === 'shortcuts')!.keys],
    onSelect: () => {
      shortcutsRequested.value = true;
    },
  },
  {
    color: 'error',
    icon: 'i-tabler-logout',
    label: t('auth.signOut'),
    onSelect: () => {
      void signOut();
    },
  },
]);

/** End the browser session before returning to the public sign-in route. */
async function signOut(): Promise<void> {
  if (signingOut.value) return;

  signingOut.value = true;
  try {
    await auth.signOut();
    await navigateTo('/auth/signin');
  } finally {
    signingOut.value = false;
  }
}
</script>

<style lang="css">
::view-transition-old(root),
::view-transition-new(root) {
  animation: none;
  mix-blend-mode: normal;
}

::view-transition-new(root) {
  z-index: 9999;
}

::view-transition-old(root) {
  z-index: 1;
}
</style>
