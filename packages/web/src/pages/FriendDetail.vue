<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useDataStore } from '../stores/data'
import HourBars from '../components/charts/HourBars.vue'
import WeekHourHeatmap from '../components/charts/WeekHourHeatmap.vue'
import WordRanks from '../components/charts/WordRanks.vue'

const route = useRoute()
const data = useDataStore()
const friend = computed(() => data.friends.find((f) => f.id === route.params.id))
</script>

<template>
  <section v-if="friend" class="friend-detail">
    <header>
      <h1>{{ friend.name }}</h1>
      <p>{{ friend.rel }} · 共 {{ friend.msgCount }} 条消息</p>
    </header>
    <h2>时段分布</h2>
    <HourBars :hourly="friend.hourly" />
    <h2>周 × 时活跃热力</h2>
    <WeekHourHeatmap :week-hour="friend.weekHour" />
    <h2>高频词</h2>
    <WordRanks :keywords="friend.keywords" />
  </section>
  <section v-else class="empty">
    <p>未找到该好友，可能数据尚未导入。</p>
    <RouterLink to="/friends">返回好友列表</RouterLink>
  </section>
</template>
