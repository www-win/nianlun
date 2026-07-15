<script setup lang="ts">
import { onLaunch, onHide } from '@dcloudio/uni-app'
import { useDataStore } from './stores/data'
import { useBackupStore } from './stores/backup'
import { useAiQueueStore } from './stores/aiQueue'
import { purgeUnzipTemp } from './adapters/fileReader'
import { storage } from './adapters/storage'
import { rawStore } from './adapters/rawStore'
onLaunch(async () => {
  // 已停止留存原文（将来二级分析改为导入时即时提取），这里一次性回收历史囤积、避免占配额：
  // ① Storage 原文残留键(nianlun:raw:*)——真机无 Console 手动清；② 文件系统原文目录(nianlun_raw)；③ 解压临时目录。
  storage.purgeLegacyRaw()
  storage.purgeLegacyBigKeys()   // ← 新增：清掉旧版存 KV 的大数据(已迁文件系统)，回收配额
  storage.migrateAiResultsToFs() // 四张 AI 结果表从 KV 搬到文件系统(去 1MB 限制)；能搬多少搬多少，缺的靠云端合并恢复补
  // @ts-ignore wx 由微信小程序运行时提供
  if (typeof wx !== 'undefined' && wx.getFileSystemManager) {
    rawStore.clear()
    // @ts-ignore
    purgeUnzipTemp(wx.getFileSystemManager(), wx.env.USER_DATA_PATH)
  }
  // 后端 A（云函数）需要云开发初始化；部署前把 env 换成你的云开发环境 ID。
  // 用后端 B（公司反代）时无需此步，可删。
  // @ts-ignore wx 由微信小程序运行时提供
  if (typeof wx !== 'undefined' && wx.cloud) {
    // @ts-ignore
    wx.cloud.init({ env: 'cloud1-d4gzww8dp909b47cb' })
  }
  await useDataStore().hydrate()

  // 备份接线 + 自动恢复放到启动后的下一个 tick，绝不挂在 onLaunch 的 await 链上：
  // 真机上若在 onLaunch 内 await 云端恢复(getOpenId 云函数 + 数据库)，云调用会拖慢 app 就绪，
  // 导致页面组件 attached 时 $vm 未就绪(点按钮无反应/报 $vm 错)。延后一 tick 即规避，且不影响功能。
  setTimeout(() => {
    const data = useDataStore()
    data.setOnSaved(() => useBackupStore().scheduleBackup())
    // AI 分析结果落盘（情绪/画像/MBTI/深度关系/命理/年度文案/全年情绪/荐股）也排一次防抖备份；
    // 一连串分析会被 scheduleBackup 合并成一次上传。
    storage.setOnChanged(() => useBackupStore().scheduleBackup())
    if (data.friends.length === 0) {
      useBackupStore().restoreNow()
        .then((ok) => (ok ? data.hydrate().then(() => useAiQueueStore().scan()) : undefined))
        .catch(() => { /* 无网/云端无备份/未部署：静默，不打断使用 */ })
    }
    useAiQueueStore().scan()   // hydrate 完成后：把未分析的好友级功能入队后台跑
  }, 0)
})

onHide(() => {
  // App 退后台：flush aiQueue（好友级四表 debounce + role 批量暂存一并落盘），
  // registry.flush() 内部已调 storage.flushNow()，这里无需再单独调一次。
  useAiQueueStore().flush()
})
</script>

<template><slot /></template>

<style>
/* 天线宝宝 设计系统（玉色点缀 · 暖中性 · 本地隐私）—— 全局令牌与共享类 */
page {
  --bg: #eefaf0;
  --surface: #ffffff;
  --surface-2: #eef6f0;
  --fg: #1e2a27;
  --muted: #5f6b66;
  --faint: #9aa39e;
  --border: #e6efe9;
  --border-2: #d6e6db;
  --accent: #43c463;
  --accent-strong: #2ea34a;
  --accent-wash: #e3f7e8;
  --accent-line: #bfe9c9;
  --danger: #e0533f;
  --cream: #fffdf6;
  --cream-2: #f3ead3;
  --ink: #3a3632;
  /* 天线宝宝主题：天空 + 四色小人 */
  --sky: #5ec8f5;
  --po: #ff6b6b;
  --dipsy: #43c463;
  --laa: #ffd23f;
  --tinky: #a97be0;

  background: var(--bg);
  color: var(--fg);
  font-size: 28rpx;
  line-height: 1.6;
  font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
}

.eyebrow {
  font-size: 22rpx; font-weight: 600; letter-spacing: 0.18em;
  text-transform: uppercase; color: var(--accent-strong);
}
.num { font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.muted { color: var(--muted); }
.faint { color: var(--faint); }

.card {
  background: var(--surface);
  border: 1rpx solid var(--border);
  border-radius: 36rpx;
  box-shadow: 0 2rpx 10rpx rgba(30, 42, 39, 0.04);
}

.btn-primary {
  display: flex; align-items: center; justify-content: center;
  height: 92rpx; border-radius: 999rpx;
  background: var(--accent); color: #fff;
  font-size: 30rpx; font-weight: 600; letter-spacing: 0.02em;
  box-shadow: 0 8rpx 20rpx rgba(67, 196, 99, 0.28);
}
.btn-primary.hover { background: var(--accent-strong); }
.btn-ghost {
  display: flex; align-items: center; justify-content: center;
  height: 76rpx; border-radius: 16rpx;
  border: 1rpx solid var(--border-2); background: var(--surface);
  color: var(--fg); font-size: 28rpx; font-weight: 550;
}

.tag {
  display: inline-flex; align-items: center;
  padding: 4rpx 16rpx; border-radius: 999rpx;
  font-size: 22rpx; font-weight: 600; color: #fff;
}

.empty {
  margin-top: 120rpx; text-align: center; color: var(--faint);
}
.empty .e-icon { font-size: 96rpx; opacity: 0.55; }
.empty .e-text { margin-top: 24rpx; font-size: 28rpx; }
</style>
