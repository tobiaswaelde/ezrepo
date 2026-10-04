<template>
  <div v-if="loading && !buckets.length" class="space-y-4">
    <USkeleton class="h-72 w-full" />
    <USkeleton class="h-5 w-64" />
  </div>
  <div v-else-if="buckets.length" class="space-y-4">
    <div>
      <svg class="h-auto w-full" viewBox="0 0 720 320" role="img" :aria-label="chartLabel">
        <g aria-hidden="true">
          <line
            v-for="tick in yTicks"
            :key="`grid-${tick.value}`"
            stroke="var(--ui-border)"
            stroke-dasharray="3 4"
            stroke-width="1"
            :x1="plot.left"
            :x2="plot.right"
            :y1="tick.y"
            :y2="tick.y"
          />
          <text
            v-for="tick in yTicks"
            :key="`label-${tick.value}`"
            class="text-[10px]"
            fill="var(--ui-text-muted)"
            text-anchor="end"
            :x="plot.left - 9"
            :y="tick.y + 3"
          >
            {{ formatNumber(tick.value) }}
          </text>
          <rect
            v-for="point in chartPoints"
            :key="`success-${point.bucket.bucketStart}`"
            class="fill-success/55"
            data-series="success"
            rx="2"
            :height="point.successHeight"
            :width="barWidth"
            :x="point.x - barWidth / 2"
            :y="point.successY"
          >
            <title>{{ bucketTooltip(point.bucket) }}</title>
          </rect>
          <rect
            v-for="point in chartPoints"
            :key="`error-${point.bucket.bucketStart}`"
            class="fill-error/70"
            data-series="error"
            rx="2"
            :height="point.errorHeight"
            :width="barWidth"
            :x="point.x - barWidth / 2"
            :y="point.errorY"
          >
            <title>{{ bucketTooltip(point.bucket) }}</title>
          </rect>
          <text
            v-for="label in xLabels"
            :key="label.bucketStart"
            class="text-[10px]"
            fill="var(--ui-text-muted)"
            :text-anchor="label.anchor"
            :x="label.x"
            :y="plot.bottom + 24"
          >
            {{ label.text }}
          </text>
        </g>
      </svg>
    </div>
    <div class="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
      <span class="flex items-center gap-2">
        <i class="size-2 rounded-sm bg-success" />
        {{ $t('dashboard.success') }} · {{ formatNumber(totalSuccesses) }}
      </span>
      <span class="flex items-center gap-2">
        <i class="size-2 rounded-sm bg-error" />
        {{ $t('dashboard.errors') }} · {{ formatNumber(totalErrors) }}
      </span>
    </div>
  </div>
  <p v-else class="py-16 text-center text-sm text-muted">{{ $t('dashboard.noTrendData') }}</p>
</template>

<script setup lang="ts">
import { defineProps } from 'vue';
import type { WorkflowRunTrendBucket } from '~/types/api/resources';

const props = defineProps<{
  buckets: WorkflowRunTrendBucket[];
  loading: boolean;
}>();

const { locale, t } = useI18n();
const plot = { bottom: 270, left: 52, right: 690, top: 28 } as const;
const plotHeight = plot.bottom - plot.top;
const plotWidth = plot.right - plot.left;

const maximumRuns = computed(() =>
  Math.max(1, ...props.buckets.map((bucket) => bucket.successCount + bucket.errorCount)),
);
const totalSuccesses = computed(() => props.buckets.reduce((total, bucket) => total + bucket.successCount, 0));
const totalErrors = computed(() => props.buckets.reduce((total, bucket) => total + bucket.errorCount, 0));
const barWidth = computed(() => Math.max(4, Math.min(28, (plotWidth / Math.max(1, props.buckets.length)) * 0.62)));

const chartPoints = computed(() => {
  const denominator = Math.max(1, props.buckets.length - 1);
  return props.buckets.map((bucket, index) => {
    const x = props.buckets.length === 1 ? plot.left + plotWidth / 2 : plot.left + (index / denominator) * plotWidth;
    const successHeight = (bucket.successCount / maximumRuns.value) * plotHeight;
    const errorHeight = (bucket.errorCount / maximumRuns.value) * plotHeight;
    return {
      bucket,
      errorHeight,
      errorY: plot.bottom - successHeight - errorHeight,
      successHeight,
      successY: plot.bottom - successHeight,
      x,
    };
  });
});

const yTicks = computed(() => createTicks(maximumRuns.value, (value) => scaleValue(value, maximumRuns.value)));
const xLabels = computed(() => {
  const lastIndex = props.buckets.length - 1;
  const indexes = [...new Set([0, Math.floor(lastIndex / 2), lastIndex])];
  return indexes.map((index, labelIndex) => ({
    anchor:
      indexes.length === 1
        ? 'middle'
        : labelIndex === 0
          ? 'start'
          : labelIndex === indexes.length - 1
            ? 'end'
            : 'middle',
    bucketStart: props.buckets[index]!.bucketStart,
    text: formatBucket(props.buckets[index]!.bucketStart),
    x: chartPoints.value[index]!.x,
  }));
});
const chartLabel = computed(() =>
  t('dashboard.trendChartLabel', { errors: totalErrors.value, successes: totalSuccesses.value }),
);

/** Create three readable ticks for one chart scale. */
function createTicks(maximum: number, scale: (value: number) => number): { value: number; y: number }[] {
  const middle = Math.round(maximum / 2);
  return [...new Set([maximum, middle, 0])].map((value) => ({ value, y: scale(value) }));
}

/** Map one value to the shared chart drawing area. */
function scaleValue(value: number, maximum: number): number {
  return plot.bottom - (value / maximum) * plotHeight;
}

/** Format one count using the active interface locale. */
function formatNumber(value: number): string {
  return new Intl.NumberFormat(locale.value).format(value);
}

/** Format one trend bucket with enough detail for the selected granularity. */
function formatBucket(timestamp: string): string {
  const includeTime = props.buckets.length > 32;
  return new Intl.DateTimeFormat(locale.value, {
    day: '2-digit',
    hour: includeTime ? '2-digit' : undefined,
    hourCycle: 'h23',
    minute: includeTime ? '2-digit' : undefined,
    month: 'short',
  }).format(new Date(timestamp));
}

/** Describe both values for a native SVG point tooltip. */
function bucketTooltip(bucket: WorkflowRunTrendBucket): string {
  return t('dashboard.trendBucketLabel', {
    date: formatBucket(bucket.bucketStart),
    errors: formatNumber(bucket.errorCount),
    successes: formatNumber(bucket.successCount),
  });
}
</script>
