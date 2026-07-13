<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { onLoad, onReady, onShow } from '@dcloudio/uni-app'
import type { Relation, FriendProfile, BirthInfo, MbtiResult } from '@nianlun/core'
import { effectiveMbtiCode, mbtiTitle, MBTI_CODES } from '@nianlun/core'
import AntennaBuddy from '../../components/AntennaBuddy.vue'
import ProgressBar from '../../components/ProgressBar.vue'
import { useDataStore } from '../../stores/data'
import { useBackupStore } from '../../stores/backup'
import { samples } from '../../adapters/samples'
import { aiClient } from '../../adapters/aiClient'
import { wordCloudItems, weekHourHeatmap, monthlyTrend, donutSegments, moodDualLinePoints } from '../../lib/insights'
import { storage } from '../../adapters/storage'
import type { StoredAstroReading } from '../../adapters/storage'
import { birthFingerprint, assembleAstro, astroExpired } from '../../lib/astroView'

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
const sentimentStale = ref(false)
const loadingSent = ref(false)
async function analyzeSentiment() {
  const f = friend.value
  if (!f) return
  const s = samples.loadSamplesFor(f.id)
  loadingSent.value = true
  try {
    const r = await aiClient.analyzeFriendSentiment(f, s)
    if (r.tone || r.summary) {
      sentiment.value = r
      storage.saveFriendSentiment(f.id, f, r)   // 仅有效结果落盘
      sentimentStale.value = false
    } else {
      sentiment.value = { summary: 'AI 无法判断情绪' } // 空结果不写盘，允许重试
    }
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loadingSent.value = false
  }
}

const profile = ref<FriendProfile | null>(null)
const profileStale = ref(false)
const loadingProfile = ref(false)
async function analyzeProfile() {
  const f = friend.value
  if (!f) return
  const s = samples.loadSamplesFor(f.id)
  loadingProfile.value = true
  try {
    const r = await aiClient.analyzeFriendProfile(f, s)
    if (r.identity || r.family || r.romance || r.lifestyle || r.investment) {
      profile.value = r
      storage.saveFriendProfile(f.id, f, r)      // 仅有效结果落盘
      profileStale.value = false
    } else {
      profile.value = { identity: 'AI 无法生成画像' } // 空结果不写盘，允许重试
    }
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loadingProfile.value = false
  }
}

const mbtiAi = ref<MbtiResult | null>(null)
const mbtiStale = ref(false)
const loadingMbti = ref(false)
const MBTI_SRC_LABEL: Record<string, string> = { manual: '手动', remark: '备注', ai: 'AI', none: '' }
const AXIS_POLES: Record<string, [string, string]> = {
  EI: ['E 外向', 'I 内向'], SN: ['S 实感', 'N 直觉'], TF: ['T 思考', 'F 情感'], JP: ['J 判断', 'P 知觉'],
}
const mbtiEff = computed(() =>
  friend.value ? effectiveMbtiCode(friend.value, mbtiAi.value?.code ?? null) : { code: null, source: 'none' as const },
)
const mbtiPickerOptions = [...MBTI_CODES, '清除']

async function analyzeMbti() {
  const f = friend.value
  if (!f || loadingMbti.value) return
  const s = samples.loadSamplesFor(f.id)
  loadingMbti.value = true
  try {
    const r = await aiClient.analyzeFriendMbti(f, s)
    if (r) { mbtiAi.value = r; storage.saveFriendMbti(f.id, f, r); mbtiStale.value = false }
    else uni.showToast({ title: 'AI 未能判断 MBTI', icon: 'none' })
  } finally { loadingMbti.value = false }
}

function onMbtiPick(e: { detail: { value: number | string } }) {
  const f = friend.value
  if (!f) return
  const i = Number(e.detail.value)
  if (i >= MBTI_CODES.length) data.updateFriend(f.id, { mbti: null })
  else data.updateFriend(f.id, { mbti: MBTI_CODES[i] })
}

function openRelationDeep() {
  const f = friend.value
  if (!f) return
  uni.navigateTo({ url: `/pages/relation-deep/relation-deep?id=${encodeURIComponent(f.id)}` })
}

// 进页/返回时装载已持久化的情绪/画像缓存，命中直显、过期打标（不自动重算）。
function loadAiCache() {
  const f = friend.value
  if (!f) return
  const sent = storage.loadFriendSentiment(f.id, f)
  if (sent) { sentiment.value = sent.data; sentimentStale.value = sent.stale }
  const prof = storage.loadFriendProfile(f.id, f)
  if (prof) { profile.value = prof.data; profileStale.value = prof.stale }
  const mb = storage.loadFriendMbti(f.id, f)
  if (mb) { mbtiAi.value = mb.data; mbtiStale.value = mb.stale }
}

// —— 命理运势 —— //
const myBazi = ref<BirthInfo | null>(null)
const friendBirth = ref<BirthInfo | null>(null)
const astro = ref<StoredAstroReading | null>(null)
const astroStale = ref(false)
const loadingAstro = ref(false)

function todayParts() {
  const d = new Date()
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
}
function todayStr(): string {
  const t = todayParts()
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`
}

function reloadBirths() {
  myBazi.value = storage.loadMyBazi()
  friendBirth.value = friend.value ? storage.loadBirths()[friend.value.id] ?? null : null
}

// 载入缓存并判过期（不自动重算）
function loadAstroCache() {
  const f = friend.value
  if (!f) { astro.value = null; astroStale.value = false; return }
  const cached = storage.loadAstroReading()[f.id] ?? null
  astro.value = cached
  astroStale.value = cached
    ? astroExpired(
        cached.generatedDate, cached.birthFingerprint, cached.myBaziFingerprint,
        todayStr(), birthFingerprint(friendBirth.value), birthFingerprint(myBazi.value),
      )
    : false
}

// 从「我的命盘」设置页返回后刷新生辰与缓存；顺带装载情绪/画像缓存
onShow(() => { reloadBirths(); loadAstroCache(); loadAiCache() })

// 实时装配（用于机械展示：五行/合盘/流日相冲——不进 AI 缓存，随日期与我的盘实时算）
const astroLive = computed(() => {
  if (!astro.value || !friendBirth.value) return null
  return assembleAstro(friendBirth.value, myBazi.value, todayParts())
})

function goSetMyBazi() {
  uni.navigateTo({ url: '/pages/my-bazi/my-bazi' })
}

// 好友生辰补录表单
const showBirthForm = ref(false)
const bYear = ref(''); const bMonth = ref(''); const bDay = ref(''); const bHour = ref('')
function openBirthForm() {
  const b = friendBirth.value
  bYear.value = b ? String(b.year) : ''
  bMonth.value = b ? String(b.month) : ''
  bDay.value = b ? String(b.day) : ''
  bHour.value = b?.hour != null ? String(b.hour) : ''
  showBirthForm.value = true
}
function saveBirth() {
  const f = friend.value; if (!f) return
  const y = Number(bYear.value), m = Number(bMonth.value), d = Number(bDay.value)
  if (!Number.isInteger(y) || y < 1900 || y > 2100 || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) {
    uni.showToast({ title: '请填写有效的年月日', icon: 'none' }); return
  }
  const b: BirthInfo = { year: y, month: m, day: d }
  if (bHour.value !== '') { const h = Number(bHour.value); if (h >= 0 && h <= 23) b.hour = h }
  const all = storage.loadBirths(); all[f.id] = b; storage.saveBirths(all)
  friendBirth.value = b
  showBirthForm.value = false
  // 触发云备份：好友生辰同样只存本地会随微信清空/换机丢失，须同步到云端
  useBackupStore().scheduleBackup()
  uni.showToast({ title: '已保存生辰', icon: 'success' })
}

const extracting = ref(false)
async function extractBirthFromChat() {
  const f = friend.value; if (!f) return
  extracting.value = true
  try {
    const b = await aiClient.extractBirth(f, samples.loadSamplesFor(f.id))
    if (b) {
      bYear.value = String(b.year); bMonth.value = String(b.month); bDay.value = String(b.day)
      bHour.value = b.hour != null ? String(b.hour) : ''
      uni.showToast({ title: '已从聊天预填，请确认', icon: 'none' })
    } else {
      uni.showToast({ title: '聊天里没找到生辰，请手填', icon: 'none' })
    }
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    extracting.value = false
  }
}

// 生成 / 刷新命理解读
async function generateAstro() {
  const f = friend.value; if (!f) return
  if (!myBazi.value) { goSetMyBazi(); return }
  if (!friendBirth.value) { openBirthForm(); return }
  loadingAstro.value = true
  try {
    const asm = assembleAstro(friendBirth.value, myBazi.value, todayParts())
    const reading = await aiClient.analyzeAstro(
      f, asm.friendChart, asm.fortune, asm.compat,
      { friend: asm.friendDayClash, my: asm.myDayClash },
    )
    const stored: StoredAstroReading = {
      reading, chart: asm.friendChart, generatedDate: todayStr(),
      birthFingerprint: birthFingerprint(friendBirth.value),
      myBaziFingerprint: birthFingerprint(myBazi.value),
    }
    const all = storage.loadAstroReading(); all[f.id] = stored; storage.saveAstroReading(all)
    astro.value = stored
    astroStale.value = false
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loadingAstro.value = false
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
          <text class="act act-ai" @click="analyzeSentiment">{{ loadingSent ? '分析中…' : (sentiment ? '↻ 重新分析' : '✦ 情绪分析') }}</text>
          <text class="act act-ai" @click="analyzeProfile">{{ loadingProfile ? '生成中…' : (profile ? '↻ 重新生成' : '✦ 好友画像') }}</text>
          <text class="act act-ai" @click="openRelationDeep">✦ 深度关系分析</text>
        </view>
        <view v-if="loadingSent || loadingProfile" class="ai-progress">
          <ProgressBar indeterminate :label="loadingSent ? 'AI 情绪分析中…' : 'AI 生成画像中…'" />
        </view>
        <input class="role-input" :value="friend.role" placeholder="职务 / 备注" placeholder-class="ph" @blur="onRole" />
        <view v-if="sentiment" class="senti">
          <text v-if="sentimentStale" class="astro-stale" @click="analyzeSentiment">数据已更新，点「重新分析」刷新</text>
          <view v-if="sentiment.tone" class="senti-tone">{{ sentiment.tone }}</view>
          <text v-if="sentiment.summary" class="senti-sum">{{ sentiment.summary }}</text>
          <text class="senti-note faint">AI 推测，仅供参考</text>
        </view>
      </view>

      <view v-if="profile" class="card block">
        <text class="block-t">好友画像</text>
        <text v-if="profileStale" class="astro-stale" @click="analyzeProfile">数据已更新，点「重新生成」刷新</text>
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

      <view class="card block">
        <view class="mbti-head">
          <text class="block-t">MBTI 人格</text>
          <text v-if="mbtiEff.code" class="mbti-src">{{ MBTI_SRC_LABEL[mbtiEff.source] }}</text>
        </view>
        <text v-if="mbtiStale && mbtiEff.source === 'ai'" class="astro-stale" @click="analyzeMbti">数据已更新，点「重新分析」刷新</text>

        <view v-if="mbtiEff.code" class="mbti-code-row">
          <text class="mbti-code">{{ mbtiEff.code }}</text>
          <text class="mbti-title">{{ mbtiTitle(mbtiEff.code) }}</text>
        </view>
        <text v-else class="prof-v">尚未识别，可从备注写入类型码、AI 分析或手动选择。</text>

        <view v-if="mbtiAi && mbtiEff.source === 'ai'" class="mbti-dims">
          <view v-for="d in mbtiAi.dimensions" :key="d.axis" class="mbti-dim">
            <text class="mbti-dim-l">{{ AXIS_POLES[d.axis][0] }}</text>
            <view class="mbti-bar">
              <view
                class="mbti-fill"
                :class="{ right: d.pole === d.axis[1] }"
                :style="{ width: d.strength + '%' }"
              ></view>
            </view>
            <text class="mbti-dim-r">{{ AXIS_POLES[d.axis][1] }}</text>
          </view>
        </view>
        <text v-if="mbtiAi && mbtiAi.summary && mbtiEff.source === 'ai'" class="prof-v mbti-summary">{{ mbtiAi.summary }}</text>

        <view class="mbti-acts">
          <picker :range="mbtiPickerOptions" @change="onMbtiPick">
            <text class="act">✎ 手动设置</text>
          </picker>
          <text
            v-if="mbtiEff.source === 'ai' || mbtiEff.source === 'none'"
            class="act act-ai"
            @click="analyzeMbti"
          >{{ loadingMbti ? '分析中…' : (mbtiAi ? '↻ 重新分析' : '✦ AI 分析 MBTI') }}</text>
        </view>
        <view v-if="loadingMbti" class="ai-progress">
          <ProgressBar indeterminate label="AI 分析 MBTI 中…" />
        </view>
      </view>

      <!-- 命理运势 -->
      <view class="card block">
        <view class="edit-row">
          <text class="block-t">☯ 命理运势</text>
          <text class="act act-ai" @click="generateAstro">
            {{ loadingAstro ? '推算中…' : (astro ? '刷新' : '生成') }}
          </text>
        </view>
        <view v-if="loadingAstro" class="ai-progress">
          <ProgressBar indeterminate label="AI 推算命理运势中…" />
        </view>

        <!-- 态1：我的命盘未设置 -->
        <view v-if="!myBazi" class="astro-tip">
          <text class="astro-tip-t">合盘与流日相冲需要先设置「我的命盘」。</text>
          <text class="astro-set" @click="goSetMyBazi">去设置我的生辰 ›</text>
        </view>

        <!-- 态2：好友生辰缺失（或正在补录） -->
        <view v-else-if="!friendBirth || showBirthForm" class="astro-form">
          <text class="astro-tip-t">这位好友还没有生辰，补录后即可排盘：</text>
          <view class="row2"><text class="lbl2">年</text><input class="inp2" type="number" v-model="bYear" placeholder="如 1990" /></view>
          <view class="row2"><text class="lbl2">月</text><input class="inp2" type="number" v-model="bMonth" placeholder="1-12" /></view>
          <view class="row2"><text class="lbl2">日</text><input class="inp2" type="number" v-model="bDay" placeholder="1-31" /></view>
          <view class="row2"><text class="lbl2">时辰</text><input class="inp2" type="number" v-model="bHour" placeholder="0-23，选填" /></view>
          <view class="form-acts">
            <text class="act act-ai" @click="extractBirthFromChat">{{ extracting ? '抽取中…' : 'AI 从聊天抽取' }}</text>
            <text class="act" @click="saveBirth">保存生辰</text>
          </view>
          <view v-if="extracting" class="ai-progress">
            <ProgressBar indeterminate label="AI 从聊天抽取生辰中…" />
          </view>
        </view>

        <!-- 态3：齐全，有解读 -->
        <view v-else-if="astro" class="astro">
          <text v-if="astroStale" class="astro-stale">基于 {{ astro.generatedDate }} 生成，点「刷新」更新</text>
          <view class="astro-glance">
            <text class="ag-i">{{ astro.chart.pillars.year }} {{ astro.chart.pillars.month }} {{ astro.chart.pillars.day }}<text v-if="astro.chart.pillars.hour"> {{ astro.chart.pillars.hour }}</text></text>
            <text class="ag-sub">{{ astro.chart.zodiac }} · {{ astro.chart.constellation }}<text v-if="!astro.chart.pillars.hour"> · 未含时柱，结果偏粗</text></text>
            <text class="ag-wx">五行：<text v-for="(n, k) in astro.chart.fiveElements" :key="k">{{ k }}{{ n }} </text></text>
          </view>
          <view class="prof-row"><text class="prof-k">性格</text><text class="prof-v">{{ astro.reading.personality || '暂无足够线索' }}</text></view>
          <view class="prof-row"><text class="prof-k">近期运势</text><text class="prof-v">{{ astro.reading.fortune || '暂无足够线索' }}</text></view>
          <view class="prof-row"><text class="prof-k">与我相性</text><text class="prof-v">{{ astro.reading.affinity || '暂无足够线索' }}</text></view>
          <view v-if="astroLive" class="astro-mech">
            <view v-if="astroLive.compat && astroLive.compat.clashes.length" class="mech-clash">
              <text v-for="(c, i) in astroLive.compat.clashes" :key="'c'+i" class="mech-tag clash">{{ c }}</text>
            </view>
            <view v-if="astroLive.compat && astroLive.compat.harmonies.length" class="mech-harm">
              <text v-for="(h, i) in astroLive.compat.harmonies" :key="'h'+i" class="mech-tag harm">{{ h }}</text>
            </view>
            <view v-if="astroLive.friendDayClash.length || astroLive.myDayClash.length" class="mech-day">
              <text v-if="astroLive.friendDayClash.length" class="mech-tag clash">今日与TA相冲（{{ astroLive.friendDayClash.join('、') }}）</text>
              <text v-if="astroLive.myDayClash.length" class="mech-tag clash">今日冲你自身（{{ astroLive.myDayClash.join('、') }}）</text>
            </view>
          </view>
          <view class="prof-row"><text class="prof-k">社交提示</text><text class="prof-v">{{ astro.reading.advice || '暂无足够线索' }}</text></view>
          <text class="senti-note faint">命理内容仅供娱乐参考</text>
          <text class="astro-reset" @click="openBirthForm">修改生辰</text>
          <text class="astro-reset" @click="goSetMyBazi">修改我的命盘</text>
        </view>

        <!-- 态3：齐全，尚未生成 -->
        <view v-else class="astro-tip">
          <text class="astro-tip-t">生辰已就绪，点右上「生成」查看命理运势。</text>
        </view>
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

.edit-row { display: flex; flex-wrap: wrap; align-items: center; gap: 16rpx; }
.ai-progress { margin-top: 20rpx; }
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

.astro-tip { margin-top: 20rpx; padding: 24rpx; background: var(--accent-wash); border-radius: 16rpx; }
.astro-tip-t { display: block; font-size: 25rpx; color: var(--fg); line-height: 1.6; }
.astro-set, .astro-reset { display: inline-block; margin-top: 14rpx; font-size: 24rpx; color: var(--accent-strong); }
.astro-reset { margin-top: 18rpx; }
.astro-form { margin-top: 20rpx; }
.row2 { display: flex; align-items: center; justify-content: space-between; padding: 14rpx 0; border-top: 1rpx solid var(--border); }
.lbl2 { font-size: 25rpx; color: var(--muted); }
.inp2 { flex: 1; margin-left: 20rpx; height: 60rpx; padding: 0 18rpx; font-size: 25rpx; color: var(--fg); background: var(--surface); border: 1rpx solid var(--border-2); border-radius: 12rpx; text-align: right; }
.form-acts { display: flex; gap: 16rpx; margin-top: 20rpx; }
.astro { margin-top: 20rpx; }
.astro-stale { display: block; margin-bottom: 16rpx; padding: 10rpx 18rpx; font-size: 22rpx; color: #b8860b; background: rgba(184,134,11,0.1); border-radius: 10rpx; }
.astro-glance { padding: 20rpx; margin-bottom: 12rpx; background: var(--accent-wash); border-radius: 16rpx; }
.ag-i { display: block; font-size: 30rpx; font-weight: 700; letter-spacing: 4rpx; color: var(--accent-strong); }
.ag-sub { display: block; margin-top: 8rpx; font-size: 22rpx; color: var(--muted); }
.ag-wx { display: block; margin-top: 8rpx; font-size: 22rpx; color: var(--muted); }
.astro-mech { margin-top: 12rpx; display: flex; flex-direction: column; gap: 10rpx; }
.mech-clash, .mech-harm, .mech-day { display: flex; flex-wrap: wrap; gap: 10rpx; }
.mech-tag { padding: 6rpx 16rpx; border-radius: 999rpx; font-size: 22rpx; }
.mech-tag.clash { background: rgba(217,106,90,0.14); color: #c0392b; }
.mech-tag.harm { background: var(--accent-wash); color: var(--accent-strong); }

.mbti-head { display: flex; align-items: center; justify-content: space-between; }
.mbti-src { font-size: 22rpx; color: #8a8f99; }
.mbti-code-row { display: flex; align-items: baseline; gap: 16rpx; margin: 12rpx 0; }
.mbti-code { font-size: 48rpx; font-weight: 700; letter-spacing: 4rpx; }
.mbti-title { font-size: 26rpx; color: #5a7fd0; }
.mbti-dims { margin: 12rpx 0; }
.mbti-dim { display: flex; align-items: center; gap: 12rpx; margin: 8rpx 0; }
.mbti-dim-l, .mbti-dim-r { font-size: 22rpx; color: #8a8f99; width: 120rpx; }
.mbti-dim-r { text-align: right; }
.mbti-bar { flex: 1; height: 12rpx; background: #eceef2; border-radius: 6rpx; overflow: hidden; position: relative; }
.mbti-fill { height: 100%; background: #5a7fd0; }
.mbti-fill.right { margin-left: auto; }
.mbti-summary { display: block; margin-top: 8rpx; }
.mbti-acts { display: flex; align-items: center; gap: 24rpx; margin-top: 12rpx; }
</style>
