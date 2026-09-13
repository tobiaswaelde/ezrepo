<template>
  <div
    class="break-words text-sm leading-6 [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc"
    v-html="html"
  />
</template>

<script setup lang="ts">
import DOMPurify from 'dompurify';
import { marked } from 'marked';

const props = defineProps<{ source: string }>();
const renderer = new marked.Renderer();
renderer.html = ({ text }) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const html = computed(() =>
  DOMPurify.sanitize(String(marked.parse(props.source, { async: false, renderer })), {
    FORBID_ATTR: ['style'],
    FORBID_TAGS: ['iframe', 'object', 'script', 'style'],
  }),
);
</script>
