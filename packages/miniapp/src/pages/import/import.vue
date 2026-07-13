<script setup lang="ts">
import { ref, computed } from 'vue'
import AntennaBuddy from '../../components/AntennaBuddy.vue'
import SunBaby from '../../components/SunBaby.vue'
import GrassHills from '../../components/GrassHills.vue'
import ProgressBar from '../../components/ProgressBar.vue'
import { fileReader } from '../../adapters/fileReader'
import { useImportStore } from '../../stores/import'
import { useDataStore } from '../../stores/data'
import { assessImportSize } from '../../lib/importGuard'

const imp = useImportStore()
const data = useDataStore()
const showHelp = ref(false)

// 报告年份（仅作报告标题用，不影响统计口径）。默认当年，可下拉选。
const years = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i)
const yearIdx = ref(0)
const year = ref(years[0])
function onYear(e: { detail: { value: number } }) {
  yearIdx.value = Number(e.detail.value)
  year.value = years[yearIdx.value]
}

const pct = computed(() => Math.round(imp.progress * 100))

const STEP_ORDER = ['reading', 'parsing', 'aggregating'] as const
/** 三步指示器某一步相对当前 phase 的类：已过→done，当前→active，未到→''。 */
function stepCls(step: (typeof STEP_ORDER)[number]) {
  const cur = STEP_ORDER.indexOf(imp.phase as (typeof STEP_ORDER)[number])
  if (cur < 0) return ''
  const me = STEP_ORDER.indexOf(step)
  if (me < cur) return 'done'
  if (me === cur) return 'active'
  return ''
}
const phaseLabel = computed(() => {
  switch (imp.phase) {
    case 'reading': return '正在读取文件…（解压中）'
    case 'parsing': return `正在解析… ${pct.value}%`
    case 'aggregating': return '正在生成报告…'
    default: return '处理中…'
  }
})

async function onImport() {
  imp.beginReading()                       // 选文件/解压前先亮①读取阶段
  try {
    // chooseMessageFile 的 count 是「最多可选」上限；原先写死 10 会让多文件导出只能选一小部分（好友大量丢失）。
    // 设 500 放宽上限（真机实际可选数仍受微信客户端限制）；超量时可分多次导入，mergeFriends 会自动累加合并。
    const files = await fileReader.pickAndRead(500)
    if (!files.length) { imp.reset(); return }   // 用户取消：清掉读取进度块
    const a = assessImportSize(files)
    if (a.warn) {
      const ok = await new Promise<boolean>((resolve) => {
        uni.showModal({
          title: '数据较大',
          content: `本次约 ${a.sizeMB.toFixed(0)} MB / ${a.count} 个文件，建议分批导入以免卡顿。仍要继续吗？`,
          success: (r) => resolve(r.confirm),
        })
      })
      if (!ok) { imp.reset(); return }           // 放弃导入：清掉读取进度块
    }
    await imp.run(files, year.value)
  } catch (e) {
    // 读文件/解压阶段的异常以前被静默吞掉（表现为「选完文件没反应」），这里显式提示
    imp.reset()                                  // 清掉卡在读取阶段的进度块
    uni.showToast({ title: (e as Error).message || '导入失败', icon: 'none' })
  }
}
</script>

<template>
  <view class="page">
    <view class="hero">
      <SunBaby class="sun" :size="120" />
      <view class="buddies">
        <AntennaBuddy :color="'var(--tinky)'" antenna="triangle" :scale="0.72" />
        <AntennaBuddy :color="'var(--dipsy)'" antenna="rod" :scale="0.86" />
        <AntennaBuddy :color="'var(--laa)'" antenna="curl" :scale="0.86" />
        <AntennaBuddy :color="'var(--po)'" antenna="ring" :scale="0.72" />
      </view>
      <GrassHills class="hills" :height="90" />
      <view class="title">天线宝宝</view>
      <view class="subtitle">把一年的微信聊天，凝成一页年度报告</view>
      <view class="privacy">🔒 全程本地处理 · 不上传任何数据</view>
    </view>

    <view class="card panel">
      <picker mode="selector" :range="years" :value="yearIdx" @change="onYear">
        <view class="field">
          <text class="field-l">报告年份</text>
          <text class="field-v">{{ year }} <text class="chev">▾</text></text>
        </view>
      </picker>

      <button class="btn-primary big" hover-class="hover" @click="onImport">
        从文件传输助手导入
      </button>

      <view v-if="imp.status === 'parsing'" class="status">
        <view class="steps3">
          <text class="s3" :class="stepCls('reading')">① 读取</text>
          <text class="s3-sep">›</text>
          <text class="s3" :class="stepCls('parsing')">② 解析</text>
          <text class="s3-sep">›</text>
          <text class="s3" :class="stepCls('aggregating')">③ 生成报告</text>
        </view>
        <ProgressBar
          :percent="imp.phase === 'parsing' ? pct : undefined"
          :indeterminate="imp.phase !== 'parsing'" />
        <text class="status-t muted">{{ phaseLabel }}</text>
      </view>
      <view v-else-if="imp.status === 'done'" class="status ok">
        <text>✅ 已导入 · 好友 {{ data.friends.length }} 位</text>
        <text v-if="imp.warnings.length" class="warn"> · {{ imp.warnings.length }} 条提示</text>
      </view>
      <view v-else-if="imp.status === 'error'" class="status err">
        导入失败：{{ imp.error }}
      </view>
      <view v-if="imp.analyzing" class="status">
        <text class="status-t muted">正在分析关系/职务… {{ imp.analyzing.done }}/{{ imp.analyzing.total }}</text>
      </view>

      <view v-if="imp.status === 'done' && imp.warnings.length" class="warns">
        <view v-for="(w, i) in imp.warnings.slice(0, 8)" :key="i" class="warn-item">· {{ w }}</view>
        <view v-if="imp.warnings.length > 8" class="warn-item muted">… 共 {{ imp.warnings.length }} 条</view>
      </view>
    </view>

    <view class="card help" @click="showHelp = !showHelp">
      <view class="help-head">
        <text class="help-q">如何导出聊天数据？</text>
        <text class="chev">{{ showHelp ? '▴' : '▾' }}</text>
      </view>
      <view v-if="showHelp" class="steps">
        <view class="step">
          <text class="sn">1</text>
          <text class="st">手机微信 → 我 → 设置 → 聊天记录管理 → 导入与导出 → 导出到电脑</text>
        </view>
        <view class="step">
          <text class="sn">2</text>
          <text class="st">电脑上用 WeFlow / WeLive 导出 CSV / JSON</text>
        </view>
        <view class="step">
          <text class="sn">3</text>
          <text class="st">把导出文件发到「文件传输助手」</text>
        </view>
        <view class="step">
          <text class="sn">4</text>
          <text class="st">回到这里点「从文件传输助手导入」，选中该文件（也可直接选一个 zip 压缩包，会自动解压并导入里面的全部文件）</text>
        </view>
        <view class="note">
          想让好友/群显示真实名字？把 WeLive 的 contacts.json 也发到文件传输助手，再导入一次即可自动套用真名。
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page { padding: 48rpx 36rpx 64rpx; }

.hero {
  position: relative; text-align: center;
  padding: 36rpx 0 40rpx; margin-bottom: 8rpx;
  background: linear-gradient(180deg, #d6f0ff 0%, #eefaf0 78%);
  border-radius: 40rpx;
}
.hero .sun { position: absolute; top: 24rpx; right: 40rpx; }
.buddies { display: flex; align-items: flex-end; justify-content: center; gap: 4rpx; padding-top: 24rpx; height: 150rpx; }
.hero .hills { margin-top: -20rpx; }
.title { font-size: 56rpx; font-weight: 700; letter-spacing: 0.08em; color: var(--fg); }
.subtitle { margin-top: 12rpx; font-size: 28rpx; color: var(--muted); }
.privacy {
  display: inline-block; margin-top: 28rpx;
  padding: 8rpx 22rpx; border-radius: 999rpx;
  background: var(--accent-wash); color: var(--accent-strong);
  border: 1rpx solid var(--accent-line);
  font-size: 23rpx; font-weight: 600;
}

.panel { padding: 36rpx; }
.field {
  display: flex; align-items: center; justify-content: space-between;
  height: 84rpx; padding: 0 28rpx; margin-bottom: 28rpx;
  background: var(--surface-2); border-radius: 16rpx;
}
.field-l { font-size: 26rpx; color: var(--muted); }
.field-v { font-size: 30rpx; font-weight: 600; color: var(--fg); }
.field-v .chev { color: var(--faint); font-size: 22rpx; }
.btn-primary.big { width: 100%; height: 100rpx; font-size: 32rpx; }

.status { margin-top: 28rpx; }
.steps3 { display: flex; align-items: center; gap: 10rpx; margin-bottom: 16rpx; }
.s3 { font-size: 22rpx; color: var(--faint); }
.s3.active { color: var(--accent-strong); font-weight: 600; }
.s3.done { color: var(--muted); }
.s3-sep { color: var(--faint); font-size: 20rpx; }
.status-t { display: block; margin-top: 14rpx; font-size: 24rpx; }
.status.ok { font-size: 27rpx; color: var(--accent-strong); font-weight: 550; }
.status.ok .raw { color: var(--accent-strong); font-weight: 550; }
.status.ok .warn { color: var(--faint); font-weight: 400; }
.status.err { font-size: 27rpx; color: var(--danger); }
.warns { margin-top: 18rpx; padding: 18rpx 22rpx; background: var(--surface-2); border-radius: 14rpx; }
.warn-item { font-size: 22rpx; color: var(--muted); line-height: 1.7; word-break: break-all; }

.help { margin-top: 28rpx; padding: 32rpx 36rpx; }
.help-head { display: flex; align-items: center; justify-content: space-between; }
.help-q { font-size: 28rpx; font-weight: 600; color: var(--fg); }
.chev { color: var(--faint); }
.steps { margin-top: 24rpx; }
.step { display: flex; align-items: flex-start; margin-top: 22rpx; }
.sn {
  flex: none; width: 38rpx; height: 38rpx; margin-right: 18rpx;
  border-radius: 50%; background: var(--accent-wash); color: var(--accent-strong);
  font-size: 22rpx; font-weight: 700; text-align: center; line-height: 38rpx;
}
.st { flex: 1; font-size: 25rpx; color: var(--muted); line-height: 1.7; }
.note {
  margin-top: 24rpx; padding: 20rpx 24rpx; border-radius: 14rpx;
  background: var(--accent-wash); color: var(--accent-strong);
  font-size: 23rpx; line-height: 1.7;
}
</style>
