<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ weekHour: number[] }>()
// 显示行序：周一..周日，对应 getDay 1,2,3,4,5,6,0
const DISPLAY_DAYS = [1, 2, 3, 4, 5, 6, 0]
const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const hours = Array.from({ length: 24 }, (_, h) => h)
const max = computed(() => Math.max(1, ...props.weekHour))
function val(day: number, hour: number) { return props.weekHour[day * 24 + hour] ?? 0 }
function alpha(n: number) { return n === 0 ? 0.04 : 0.15 + 0.85 * (n / max.value) }
</script>

<template>
  <div class="heatmap">
    <div v-for="(day, row) in DISPLAY_DAYS" :key="day" class="hm-row">
      <span class="hm-label">{{ DAY_LABELS[row] }}</span>
      <span
        v-for="h in hours"
        :key="h"
        class="hm-cell"
        :data-cell="`${row}-${h}`"
        :style="{ backgroundColor: `rgba(200,155,60,${alpha(val(day, h))})` }"
        :title="`周${DAY_LABELS[row]} ${h} 时：${val(day, h)} 条`"
      />
    </div>
  </div>
</template>

<style scoped>
.heatmap { display: flex; flex-direction: column; gap: 2px; }
.hm-row { display: flex; align-items: center; gap: 2px; }
.hm-label { width: 1.5em; font-size: 12px; color: #888; text-align: center; }
.hm-cell { width: 12px; height: 12px; border-radius: 2px; }
</style>
