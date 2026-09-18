<template>
  <UModal
    v-model:open="open"
    :content="{ onOpenAutoFocus: captureFocus, onCloseAutoFocus: restoreFocus }"
    :description="t('shortcuts.description')"
    :title="t('shortcuts.title')"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <table class="w-full text-left text-sm">
        <thead class="text-muted">
          <tr>
            <th class="p-2 font-medium" scope="col">{{ t('shortcuts.scope') }}</th>
            <th class="p-2 font-medium" scope="col">{{ t('shortcuts.keys') }}</th>
            <th class="p-2 font-medium" scope="col">{{ t('shortcuts.action') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="shortcut in globalShortcuts" :key="shortcut.id" class="border-t border-default">
            <td class="p-2">{{ t(shortcut.scope) }}</td>
            <td class="p-2">
              <span class="flex gap-1">
                <UKbd v-for="key in shortcut.keys" :key="key" :value="key" />
              </span>
            </td>
            <td class="p-2">{{ t(shortcut.action) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { useShortcuts } from '~/composables/app/shortcuts';
import { globalShortcuts } from '~/util/shortcuts';

const { t } = useI18n();
const { open } = useShortcuts();
let previousFocus: HTMLElement | null = null;

/** Remember the menu trigger or keyboard origin before the modal moves focus. */
function captureFocus(): void {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

/** A controlled dialog has no built-in trigger to restore focus to. */
function restoreFocus(event: Event): void {
  event.preventDefault();
  if (previousFocus?.isConnected) previousFocus.focus();
  previousFocus = null;
}
</script>
