<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ keywords: Array<{ word: string; count: number }> }>()
const max = computed(() => Math.max(1, ...props.keywords.map((k) => k.count)))
function pct(n: number) { return `${Math.round((n / max.value) * 100)}%` }
</script>

<template>
  <div class="word-ranks">
    <p v-if="keywords.length === 0" class="empty">暂无高频词</p>
    <div v-for="k in keywords" :key="k.word" class="row" :data-word="k.word">
      <span class="w">{{ k.word }}</span>
      <span class="bar"><span class="fill" :style="{ width: pct(k.count) }" /></span>
      <span class="c">{{ k.count }}</span>
    </div>
  </div>
</template>

<style scoped>
.word-ranks { display: flex; flex-direction: column; gap: 4px; }
.row { display: grid; grid-template-columns: 4em 1fr 3em; align-items: center; gap: 8px; }
.w { font-size: 14px; }
.bar { background: #eee; border-radius: 3px; height: 10px; overflow: hidden; }
.fill { display: block; height: 100%; background: var(--accent, #c89b3c); }
.c { text-align: right; font-size: 12px; color: #888; }
.empty { color: #aaa; font-size: 13px; }
</style>
