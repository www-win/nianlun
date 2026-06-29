<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ hourly: number[] }>()
const max = computed(() => Math.max(1, ...props.hourly))
function pct(n: number) { return `${Math.round((n / max.value) * 100)}%` }
</script>

<template>
  <div class="hour-bars">
    <div
      v-for="(n, h) in hourly"
      :key="h"
      class="bar"
      :data-h="h"
      :style="{ height: pct(n) }"
      :title="`${h} 时：${n} 条`"
    />
  </div>
</template>

<style scoped>
.hour-bars { display: flex; align-items: flex-end; gap: 2px; height: 120px; }
.bar { flex: 1; min-height: 1px; background: var(--accent, #c89b3c); border-radius: 2px 2px 0 0; }
</style>
