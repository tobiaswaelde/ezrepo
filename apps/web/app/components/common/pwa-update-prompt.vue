<template>
  <div
    v-if="needsRefresh && !dismissed"
    class="fixed inset-x-4 bottom-4 z-[10000] mx-auto max-w-xl"
    data-pwa-update-prompt
  >
    <UAlert
      color="primary"
      icon="i-lucide-refresh-cw"
      orientation="horizontal"
      variant="solid"
      :description="updateFailed ? t('pwa.updateError') : t('pwa.updateDescription')"
      :title="t('pwa.updateTitle')"
    >
      <template #actions>
        <div class="flex shrink-0 items-center gap-2">
          <UButton
            color="neutral"
            size="sm"
            variant="ghost"
            :disabled="updating"
            :label="t('pwa.later')"
            @click="dismissed = true"
          />
          <UButton
            color="neutral"
            size="sm"
            variant="solid"
            :label="t('pwa.update')"
            :loading="updating"
            @click="activateUpdate"
          />
        </div>
      </template>
    </UAlert>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

const { t } = useI18n();
const { $pwa: pwa } = useNuxtApp();
const dismissed = ref(false);
const needsRefresh = computed(() => pwa?.needRefresh ?? false);
const updateFailed = ref(false);
const updating = ref(false);

/** Activate the waiting service worker and reload only after the update request completes. */
async function activateUpdate(): Promise<void> {
  if (!pwa) return;
  updating.value = true;
  updateFailed.value = false;
  try {
    await pwa.updateServiceWorker(true);
  } catch {
    updateFailed.value = true;
  } finally {
    updating.value = false;
  }
}
</script>
