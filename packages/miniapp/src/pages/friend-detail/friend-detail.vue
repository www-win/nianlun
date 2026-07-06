<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { onLoad, onReady } from '@dcloudio/uni-app'
import type { Relation, FriendProfile } from '@nianlun/core'
import AntennaBuddy from '../../components/AntennaBuddy.vue'
import { useDataStore } from '../../stores/data'
import { samples } from '../../adapters/samples'
import { aiClient } from '../../adapters/aiClient'
import { wordCloudItems, weekHourHeatmap, monthlyTrend, donutSegments, moodDualLinePoints } from '../../lib/insights'

const data = useDataStore()
const id = ref('')
onLoad((q) => {
  id.value = decodeURIComponent((q?.id as string) || '')
  setTimeout(drawEmotion, 120)
})

const friend = computed(() => data.friends.find((f) => f.id === id.value) || null)

const emotion = computed(() => friend.value?.emotion ?? null)
const meDonut = computed(() => (emotion.value ? donutSegments(emotion.value.me) : []))
const themDonut = computed(() => (emotion.value ? donutSegments(emotion.value.them) : []))
const hasMood = computed(() => !!emotion.value && moodDualLinePoints(
  emotion.value.monthly, { width: 300, height: 150, pad: 20 }).hasData)

const pct = (n: number, total: number) => (total === 0 ? 0 : Math.round((n / total) * 100))

// canvas 绘制坐标系 = 画布 CSS 像素，不做 rpx 换算 → 尺寸必须用设备 px。
// 设计稿：环形 120rpx、折线高 300rpx；upx2px 按当前设备把 rpx 换成 px。
const donutPx = uni.upx2px(120)
const moodPx = uni.upx2px(300)

function drawDonut(canvasId: string, segs: ReturnType<typeof donutSegments>) {
  const ctx = uni.createCanvasContext(canvasId)
  // 保持原视觉比例(基于 120)：圆心 0.5、半径 0.383、线宽 0.183
  const cx = donutPx / 2, cy = donutPx / 2, r = donutPx * 0.38, lw = donutPx * 0.18
  ctx.setLineWidth(lw)
  if (segs.length === 0) {
    ctx.beginPath(); ctx.setStrokeStyle('#e5e7eb')
    ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
  } else {
    for (const s of segs) {
      if (s.frac === 0) continue
      ctx.beginPath(); ctx.setStrokeStyle(s.color)
      ctx.arc(cx, cy, r, s.start, s.end); ctx.stroke()
    }
  }
  ctx.draw()
}

function drawMood() {
  const emo = emotion.value
  if (!emo) return
  // 折线宽度随设备/布局变化 → 用 selectorQuery 量真实渲染尺寸，绘制坐标系与画布严格一致。
  uni.createSelectorQuery().select('.mood-canvas').boundingClientRect((res) => {
    const rect = res as UniApp.NodeInfo
    const W = rect && rect.width ? rect.width : moodPx
    const H = rect && rect.height ? rect.height : moodPx
    const pad = 20
    const dl = moodDualLinePoints(emo.monthly, { width: W, height: H, pad })
    const ctx = uni.createCanvasContext('moodLine')
    // 0.5 中线
    const midY = H - pad - 0.5 * (H - 2 * pad)
    ctx.beginPath(); ctx.setStrokeStyle('#e5e7eb'); ctx.setLineWidth(1)
    ctx.moveTo(pad, midY); ctx.lineTo(W - pad, midY); ctx.stroke()
    // 只连相邻月（m 差 1），断开处不连线
    const drawLine = (pts: typeof dl.me, color: string) => {
      ctx.setStrokeStyle(color); ctx.setLineWidth(2)
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].m - pts[i - 1].m !== 1) continue
        ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke()
      }
      for (const p of pts) { ctx.beginPath(); ctx.setFillStyle(color); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill() }
    }
    drawLine(dl.me, '#e8a04b')     // 我=暖
    drawLine(dl.them, '#5a8fd0')   // TA=冷
    ctx.draw()
  }).exec()
}

function drawEmotion() {
  if (!emotion.value) return
  drawDonut('donutMe', meDonut.value)
  drawDonut('donutThem', themDonut.value)
  if (hasMood.value) drawMood()
}

onReady(() => { setTimeout(drawEmotion, 50) }) // 等布局
// emotion 来自 store，hydrate 异步 → 数据到达后重绘，避免两次 setTimeout 都早于数据时画布永久空白。
watch(emotion, () => nextTick(drawEmotion))

const REL_COLORS: Record<string, string> = {
  家人: '#d96a5a', 挚友: '#43a86a', 同事: '#5a7fd0', 同学: '#cf9a36', 客户: '#b066b0', 其他: '#8a8f99',
}
const relColor = (r: string) => REL_COLORS[r] || '#8a8f99'
const initials = (n: string) => n.slice(n.length > 1 ? n.length - 2 : 0)
const fmtDate = (ts: number) => (ts ? new Date(ts).toISOString().slice(0, 10) : '—')

const FONT = { 1: 24, 2: 28, 3: 33, 4: 39, 5: 46 } as Record<number, number>
const OPACITY = { 1: 0.45, 2: 0.6, 3: 0.72, 4: 0.86, 5: 1 } as Record<number, number>
const HOUR_TICKS = [0, 6, 12, 18, 23]

const trend = computed(() => monthlyTrend(friend.value ? [friend.value] : []))
// 高频词 / 活跃时段 / 样本改为「最近一个月」：优先用导入时算好的近期数据；
// 老数据（近期存储为空）时 recentInsight 为 null，回退到全年字段。
const recentInsight = computed(() => samples.loadRecentInsightsFor(id.value))
const isRecent = computed(() => recentInsight.value !== null)
const heat = computed(() => weekHourHeatmap(
  recentInsight.value ? recentInsight.value.weekHour : (friend.value?.weekHour ?? []),
))
const words = computed(() => wordCloudItems(
  recentInsight.value ? recentInsight.value.keywords : (friend.value?.keywords ?? []),
))
const wordColor = (word: string): string => {
  const w = emotion.value?.words.find((x) => x.word === word)
  const p = w ? w.polarity : 0
  if (p > 0.15) return '#e8a04b'
  if (p < -0.15) return '#5a8fd0'
  return '#9aa0aa'
}
// 样本存储为时间升序，展示时倒序 → 最近的聊天排最前。
const chatSamples = computed(() =>
  (samples.loadRecentSamplesFor(id.value) ?? samples.loadSamplesFor(id.value)).slice().reverse(),
)
const showSamples = ref(false)

function cellAlpha(count: number): number {
  if (heat.value.max === 0) return 0
  return count === 0 ? 0 : 0.12 + (count / heat.value.max) * 0.88
}

const RELS: Relation[] = ['家人', '挚友', '同事', '同学', '客户', '其他']
function onRel(e: { detail: { value: number } }) {
  if (friend.value) data.updateFriend(friend.value.id, { rel: RELS[e.detail.value] })
}
function onRole(e: { detail: { value: string } }) {
  if (friend.value) data.updateFriend(friend.value.id, { role: e.detail.value })
}

const sentiment = ref<{ tone?: string; summary?: string } | null>(null)
const loadingSent = ref(false)
async function analyzeSentiment() {
  const f = friend.value
  if (!f) return
  const s = samples.loadSamplesFor(f.id)
  loadingSent.value = true
  try {
    const r = await aiClient.analyzeFriendSentiment(f, s)
    sentiment.value = (r.tone || r.summary) ? r : { summary: 'AI 无法判断情绪' }
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loadingSent.value = false
  }
}

const profile = ref<FriendProfile | null>(null)
const loadingProfile = ref(false)
async function analyzeProfile() {
  const f = friend.value
  if (!f) return
  const s = samples.loadSamplesFor(f.id)
  loadingProfile.value = true
  try {
    const r = await aiClient.analyzeFriendProfile(f, s)
    profile.value = (r.identity || r.family || r.romance || r.lifestyle || r.investment)
      ? r
      : { identity: 'AI 无法生成画像' }
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loadingProfile.value = false
  }
}
</script>

<template>
  <view class="page">
    <view v-if="!friend" class="empty">
      <view class="e-icon">🙁</view>
      <view class="e-text">找不到这位好友，可能数据已更新</view>
    </view>

    <template v-else>
      <view class="card head">
        <AntennaBuddy class="head-buddy" :color="relColor(friend.rel)" antenna="rod" :scale="0.6" />
        <view class="avatar" :style="{ background: relColor(friend.rel) }">{{ initials(friend.alias || friend.name) }}</view>
        <text class="name">{{ friend.alias || friend.name }}</text>
        <view class="tags">
          <view class="tag" :style="{ background: relColor(friend.rel) }">{{ friend.rel }}</view>
          <text v-if="friend.role" class="role-tag">{{ friend.role }}</text>
        </view>
      </view>

      <view class="card block">
        <view class="kv-grid">
          <view class="kv"><text class="kv-v num">{{ friend.msgCount }}</text><text class="kv-l">消息总数</text></view>
          <view class="kv"><text class="kv-v num">{{ friend.sentRatio }}%</text><text class="kv-l">我方占比</text></view>
          <view class="kv"><text class="kv-v num">{{ friend.maxStreak }}</text><text class="kv-l">最长连聊(天)</text></view>
        </view>
        <view class="kv-lines">
          <view class="kv-line"><text class="kl">活跃时段</text><text class="kr">{{ friend.peakPeriod || '—' }}</text></view>
          <view class="kv-line"><text class="kl">首次联系</text><text class="kr">{{ fmtDate(friend.firstContact) }}</text></view>
          <view class="kv-line"><text class="kl">最近联系</text><text class="kr">{{ fmtDate(friend.lastContact) }}</text></view>
        </view>
      </view>

      <view v-if="trend.total > 0" class="card block">
        <text class="block-t">月度趋势</text>
        <view class="bars">
          <view v-for="m in trend.months" :key="m.label" class="bar-col">
            <view class="bar-track"><view class="bar-fill" :style="{ height: m.pct + '%' }"></view></view>
            <text class="bar-lbl">{{ m.label.replace('月', '') }}</text>
          </view>
        </view>
      </view>

      <view v-if="heat.max > 0" class="card block">
        <text class="block-t">活跃时段<text v-if="isRecent" class="block-sub">· 近一个月</text></text>
        <view class="hm">
          <view class="hm-axis">
            <text class="hm-corner"></text>
            <view class="hm-ticks">
              <text v-for="h in 24" :key="h" class="hm-tick">{{ HOUR_TICKS.includes(h - 1) ? (h - 1) : '' }}</text>
            </view>
          </view>
          <view v-for="row in heat.rows" :key="row.label" class="hm-row">
            <text class="hm-day">{{ row.label }}</text>
            <view class="hm-cells">
              <view
                v-for="(c, i) in row.cells" :key="i"
                class="hm-cell"
                :style="{ backgroundColor: 'rgba(67,196,99,' + cellAlpha(c) + ')' }"
              ></view>
            </view>
          </view>
        </view>
        <text v-if="heat.peak" class="hm-peak muted">最活跃：周{{ heat.peak.label }} {{ heat.peak.hour }} 点</text>
      </view>

      <view v-if="words.length" class="card block">
        <text class="block-t">高频词<text v-if="isRecent" class="block-sub">· 近一个月</text></text>
        <view class="cloud">
          <text
            v-for="w in words" :key="w.word"
            class="word"
            :style="{ fontSize: FONT[w.tier] + 'rpx', opacity: OPACITY[w.tier], color: wordColor(w.word) }"
          >{{ w.word }}</text>
        </view>
      </view>

      <view v-if="emotion" class="card block">
        <text class="block-t">情绪价值分布</text>
        <view class="emo-donuts">
          <view class="emo-col">
            <canvas canvas-id="donutMe" class="donut" :style="{ width: donutPx + 'px', height: donutPx + 'px' }"></canvas>
            <text class="emo-side">我</text>
            <text class="emo-avg">平均情绪值 {{ emotion.me.avg.toFixed(2) }}</text>
            <text class="emo-break">开心 {{ pct(emotion.me.happy, emotion.me.total) }}% · 平淡 {{ pct(emotion.me.neutral, emotion.me.total) }}% · 难过 {{ pct(emotion.me.sad, emotion.me.total) }}%</text>
          </view>
          <view class="emo-col">
            <canvas canvas-id="donutThem" class="donut" :style="{ width: donutPx + 'px', height: donutPx + 'px' }"></canvas>
            <text class="emo-side">TA</text>
            <text class="emo-avg">平均情绪值 {{ emotion.them.avg.toFixed(2) }}</text>
            <text class="emo-break">开心 {{ pct(emotion.them.happy, emotion.them.total) }}% · 平淡 {{ pct(emotion.them.neutral, emotion.them.total) }}% · 难过 {{ pct(emotion.them.sad, emotion.them.total) }}%</text>
          </view>
        </view>
        <view class="emo-legend">
          <text class="lg"><text class="dot" style="background:#e8a04b"></text>开心</text>
          <text class="lg"><text class="dot" style="background:#b8bcc4"></text>平淡</text>
          <text class="lg"><text class="dot" style="background:#5a8fd0"></text>难过</text>
        </view>
        <text class="senti-note faint">本地词典估算，仅供参考</text>
      </view>

      <view v-if="emotion" class="card block">
        <text class="block-t">情绪波动</text>
        <template v-if="hasMood">
          <view class="mood-legend">
            <text class="lg"><text class="dot" style="background:#e8a04b"></text>我</text>
            <text class="lg"><text class="dot" style="background:#5a8fd0"></text>TA</text>
          </view>
          <canvas canvas-id="moodLine" class="mood-canvas" :style="{ height: moodPx + 'px' }"></canvas>
          <text class="senti-note faint">本地词典估算，仅供参考</text>
        </template>
        <text v-else class="faint mood-empty">样本不足，暂无法生成情绪走势</text>
      </view>

      <view class="card block">
        <view class="edit-row">
          <picker :range="RELS" @change="onRel"><text class="act">改关系</text></picker>
          <text class="act act-ai" @click="analyzeSentiment">{{ loadingSent ? '分析中…' : '✦ 情绪分析' }}</text>
          <text class="act act-ai" @click="analyzeProfile">{{ loadingProfile ? '生成中…' : '✦ 好友画像' }}</text>
        </view>
        <input class="role-input" :value="friend.role" placeholder="职务 / 备注" placeholder-class="ph" @blur="onRole" />
        <view v-if="sentiment" class="senti">
          <view v-if="sentiment.tone" class="senti-tone">{{ sentiment.tone }}</view>
          <text v-if="sentiment.summary" class="senti-sum">{{ sentiment.summary }}</text>
          <text class="senti-note faint">AI 推测，仅供参考</text>
        </view>
      </view>

      <view v-if="profile" class="card block">
        <text class="block-t">好友画像</text>
        <view class="prof">
          <view class="prof-row"><text class="prof-k">身份/职业</text><text class="prof-v">{{ profile.identity || '暂无足够线索' }}</text></view>
          <view class="prof-row"><text class="prof-k">家庭状况</text><text class="prof-v">{{ profile.family || '暂无足够线索' }}</text></view>
          <view class="prof-row"><text class="prof-k">感情状态</text><text class="prof-v">{{ profile.romance || '暂无足够线索' }}</text></view>
          <view class="prof-row"><text class="prof-k">生活方式</text><text class="prof-v">{{ profile.lifestyle || '暂无足够线索' }}</text></view>
        </view>
        <view class="prof-inv">
          <text class="prof-inv-t">投资偏好</text>
          <text class="prof-inv-sum">{{ (profile.investment && profile.investment.summary) || '暂无足够线索' }}</text>
          <view class="prof-row"><text class="prof-k">风险偏好</text><text class="prof-v">{{ (profile.investment && profile.investment.risk) || '暂无足够线索' }}</text></view>
          <view class="prof-row"><text class="prof-k">关注品类</text><text class="prof-v">{{ (profile.investment && profile.investment.categories) || '暂无足够线索' }}</text></view>
          <view class="prof-row"><text class="prof-k">财富线索</text><text class="prof-v">{{ (profile.investment && profile.investment.wealth) || '暂无足够线索' }}</text></view>
          <view class="prof-row"><text class="prof-k">决策风格</text><text class="prof-v">{{ (profile.investment && profile.investment.style) || '暂无足够线索' }}</text></view>
        </view>
        <text class="senti-note faint">AI 推测，仅供参考</text>
      </view>

      <view v-if="chatSamples.length" class="card block">
        <view class="block-head" @click="showSamples = !showSamples">
          <text class="block-t">聊天样本（{{ chatSamples.length }}）<text v-if="isRecent" class="block-sub">· 近一个月</text></text>
          <text class="chev">{{ showSamples ? '▴' : '▾' }}</text>
        </view>
        <view v-if="showSamples" class="samples">
          <text v-for="(s, i) in chatSamples" :key="i" class="sample">{{ s }}</text>
        </view>
        <text v-else class="samples-hint faint">本地样本，仅存于本机、不上传 · 点开查看</text>
      </view>
    </template>
  </view>
</template>

<style scoped>
.page { padding: 32rpx 28rpx 64rpx; }

.head { position: relative; display: flex; flex-direction: column; align-items: center; padding: 44rpx 32rpx; overflow: hidden; }
.head-buddy { position: absolute; top: 10rpx; right: 20rpx; opacity: 0.9; }
.avatar {
  width: 120rpx; height: 120rpx; border-radius: 32rpx;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 40rpx; font-weight: 600;
}
.name { margin-top: 20rpx; font-size: 36rpx; font-weight: 700; color: var(--fg); }
.tags { display: flex; align-items: center; gap: 14rpx; margin-top: 14rpx; }
.tag { padding: 4rpx 18rpx; border-radius: 999rpx; font-size: 22rpx; font-weight: 600; color: #fff; }
.role-tag { padding: 4rpx 16rpx; border-radius: 8rpx; font-size: 22rpx; background: var(--accent-wash); color: var(--accent-strong); }

.block { margin-top: 24rpx; padding: 32rpx 36rpx; }
.block-t { font-size: 28rpx; font-weight: 600; color: var(--fg); }
.block-sub { margin-left: 10rpx; font-size: 22rpx; font-weight: 400; color: var(--faint); }
.block-head { display: flex; align-items: center; justify-content: space-between; }
.chev { color: var(--faint); }

.kv-grid { display: flex; }
.kv { flex: 1; display: flex; flex-direction: column; align-items: center; }
.kv-v { font-size: 44rpx; font-weight: 700; color: var(--accent-strong); }
.kv-l { margin-top: 6rpx; font-size: 22rpx; color: var(--muted); }
.kv-lines { margin-top: 28rpx; }
.kv-line { display: flex; justify-content: space-between; padding: 14rpx 0; border-top: 1rpx solid var(--border); }
.kl { font-size: 25rpx; color: var(--muted); }
.kr { font-size: 25rpx; color: var(--fg); }

.bars { display: flex; align-items: flex-end; gap: 8rpx; height: 200rpx; margin-top: 28rpx; }
.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; }
.bar-track { flex: 1; width: 100%; display: flex; align-items: flex-end; }
.bar-fill { width: 100%; min-height: 4rpx; background: var(--accent); border-radius: 6rpx 6rpx 0 0; }
.bar-lbl { margin-top: 10rpx; font-size: 20rpx; color: var(--faint); }

.hm { margin-top: 24rpx; }
.hm-axis, .hm-row { display: flex; align-items: center; }
.hm-row { margin-top: 6rpx; }
.hm-corner, .hm-day { flex: none; width: 40rpx; font-size: 22rpx; color: var(--faint); text-align: center; }
.hm-ticks, .hm-cells { flex: 1; display: flex; gap: 4rpx; }
.hm-tick { flex: 1; font-size: 18rpx; color: var(--faint); text-align: center; }
.hm-cell { flex: 1; height: 26rpx; border-radius: 4rpx; background: var(--surface-2); }
.hm-peak { display: block; margin-top: 20rpx; font-size: 23rpx; }

.cloud { display: flex; flex-wrap: wrap; align-items: baseline; gap: 16rpx 24rpx; margin-top: 24rpx; }
.word { color: var(--accent-strong); font-weight: 600; line-height: 1.2; }

.edit-row { display: flex; align-items: center; gap: 16rpx; }
.act { padding: 12rpx 22rpx; border-radius: 12rpx; font-size: 24rpx; font-weight: 550; color: var(--muted); background: var(--surface-2); }
.act-ai { color: var(--accent-strong); background: var(--accent-wash); }
.role-input { margin-top: 18rpx; height: 64rpx; padding: 0 20rpx; font-size: 25rpx; color: var(--fg); background: var(--surface); border: 1rpx solid var(--border-2); border-radius: 12rpx; }
.ph { color: var(--faint); }
.senti { margin-top: 24rpx; padding: 24rpx; background: var(--accent-wash); border-radius: 16rpx; }
.senti-tone { display: inline-block; padding: 6rpx 22rpx; border-radius: 999rpx; background: var(--accent); color: #fff; font-size: 26rpx; font-weight: 600; }
.senti-sum { display: block; margin-top: 16rpx; font-size: 27rpx; color: var(--fg); line-height: 1.7; }
.senti-note { display: block; margin-top: 12rpx; font-size: 21rpx; }

.prof { margin-top: 20rpx; }
.prof-row { display: flex; padding: 14rpx 0; border-top: 1rpx solid var(--border); }
.prof-k { flex: none; width: 140rpx; font-size: 24rpx; color: var(--muted); }
.prof-v { flex: 1; font-size: 25rpx; color: var(--fg); line-height: 1.6; }
.prof-inv { margin-top: 24rpx; padding: 24rpx; background: var(--accent-wash); border-radius: 16rpx; }
.prof-inv-t { display: block; font-size: 26rpx; font-weight: 600; color: var(--accent-strong); }
.prof-inv-sum { display: block; margin: 12rpx 0 4rpx; font-size: 25rpx; color: var(--fg); line-height: 1.7; }

.samples { margin-top: 20rpx; }
.sample { display: block; padding: 14rpx 0; border-top: 1rpx solid var(--border); font-size: 25rpx; color: var(--muted); line-height: 1.6; }
.samples-hint { display: block; margin-top: 16rpx; font-size: 22rpx; }

.empty { margin-top: 160rpx; text-align: center; color: var(--faint); }
.e-icon { font-size: 96rpx; opacity: 0.5; }
.e-text { margin-top: 24rpx; font-size: 28rpx; }

.emo-donuts { display: flex; gap: 24rpx; margin-top: 24rpx; }
.emo-col { flex: 1; display: flex; flex-direction: column; align-items: center; }
.donut { width: 120rpx; height: 120rpx; }  /* 兜底；实际尺寸由内联 px 覆盖，保证与绘制坐标系一致 */
.emo-side { margin-top: 8rpx; font-size: 26rpx; font-weight: 600; color: var(--fg); }
.emo-avg { margin-top: 6rpx; font-size: 23rpx; color: var(--accent-strong); }
.emo-break { margin-top: 4rpx; font-size: 21rpx; color: var(--muted); text-align: center; line-height: 1.5; }
.emo-legend, .mood-legend { display: flex; gap: 24rpx; justify-content: center; margin-top: 20rpx; }
.lg { display: flex; align-items: center; font-size: 22rpx; color: var(--muted); }
.dot { display: inline-block; width: 16rpx; height: 16rpx; border-radius: 999rpx; margin-right: 8rpx; }
.mood-canvas { width: 100%; margin-top: 12rpx; }  /* 高度由内联 px 绑定；宽度 100% 的真实 px 由 selectorQuery 量取 */
.mood-empty { display: block; margin-top: 24rpx; font-size: 24rpx; text-align: center; }
</style>
