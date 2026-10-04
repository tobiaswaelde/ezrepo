<template>
  <UModal
    v-model:open="open"
    :description="$t('settings.avatarCropDescription')"
    :dismissible="!applying"
    :title="$t('settings.avatarCropTitle')"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div class="space-y-4">
        <UAlert v-if="cropError" color="error" icon="i-lucide-circle-alert" variant="subtle" :title="cropError" />
        <div ref="cropContainer" class="h-96 overflow-hidden rounded-lg bg-black">
          <img ref="image" class="block max-w-full" :alt="$t('settings.avatarCropPreview')" :src="source" />
        </div>
        <div class="flex flex-wrap justify-between gap-2">
          <div class="flex gap-2">
            <UButton
              color="neutral"
              icon="i-lucide-zoom-out"
              variant="soft"
              :aria-label="$t('settings.avatarZoomOut')"
              @click="zoom(-0.1)"
            />
            <UButton
              color="neutral"
              icon="i-lucide-zoom-in"
              variant="soft"
              :aria-label="$t('settings.avatarZoomIn')"
              @click="zoom(0.1)"
            />
            <UButton
              color="neutral"
              icon="i-lucide-rotate-ccw"
              variant="soft"
              :label="$t('settings.avatarCropReset')"
              @click="reset"
            />
          </div>
          <div class="flex gap-2">
            <UButton color="neutral" variant="ghost" :label="$t('settings.avatarCropCancel')" @click="open = false" />
            <UButton :label="$t('settings.avatarCropApply')" :loading="applying" @click="apply" />
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import Cropper from 'cropperjs';
import { defineEmits, defineModel, defineProps, nextTick, onBeforeUnmount, ref, watch } from 'vue';

defineProps<{ source: string }>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ cropped: [file: File] }>();
const { t } = useI18n();
const cropContainer = ref<HTMLElement>();
const image = ref<HTMLImageElement>();
const cropper = ref<Cropper>();
const applying = ref(false);
const cropError = ref('');

watch(
  open,
  async (isOpen) => {
    destroy();
    cropError.value = '';
    if (!isOpen) return;
    await nextTick();
    if (!image.value || !cropContainer.value) return;
    cropper.value = new Cropper(image.value, { container: cropContainer.value });
    const selection = cropper.value.getCropperSelection();
    if (selection) {
      selection.aspectRatio = 1;
      selection.initialAspectRatio = 1;
      selection.initialCoverage = 0.8;
      selection.$reset();
    }
  },
  { immediate: true },
);

/** Scale the source image while retaining the square crop selection. */
function zoom(amount: number): void {
  cropper.value?.getCropperImage()?.$zoom(amount);
}

/** Restore the initial image transform and centered square selection. */
function reset(): void {
  cropper.value?.getCropperImage()?.$resetTransform();
  cropper.value?.getCropperSelection()?.$reset();
}

/** Render the selected square to a WebP file for the protected upload endpoint. */
async function apply(): Promise<void> {
  const selection = cropper.value?.getCropperSelection();
  if (!selection || applying.value) return;
  applying.value = true;
  try {
    const canvas = await selection.$toCanvas({ height: 256, width: 256 });
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('Crop rendering failed.'))),
        'image/webp',
        0.9,
      ),
    );
    emit('cropped', new File([blob], 'avatar.webp', { type: 'image/webp' }));
    open.value = false;
  } catch {
    cropError.value = t('settings.avatarCropError');
  } finally {
    applying.value = false;
  }
}

function destroy(): void {
  cropper.value?.destroy();
  cropper.value = undefined;
}

onBeforeUnmount(destroy);
</script>

<style scoped>
:deep(cropper-canvas) {
  height: 100%;
  width: 100%;
}
</style>
