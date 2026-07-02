<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { useDataStore } from './stores/data'
import { useImportStore } from './stores/import'
onLaunch(async () => {
  // 后端 A（云函数）需要云开发初始化；部署前把 env 换成你的云开发环境 ID。
  // 用后端 B（公司反代）时无需此步，可删。
  // @ts-ignore wx 由微信小程序运行时提供
  if (typeof wx !== 'undefined' && wx.cloud) {
    // @ts-ignore
    wx.cloud.init({ env: 'cloud1-d4gzww8dp909b47cb' })
  }
  await useDataStore().hydrate()
  // 启动后台补分析：存量里「消息达标且未分析」的好友，串行渐进补关系/职务，不阻塞启动。
  void useImportStore().analyzePendingRoles()
})
</script>

<template><slot /></template>

<style>
/* 年轮 设计系统（玉色点缀 · 暖中性 · 本地隐私）—— 全局令牌与共享类 */
page {
  --bg: #f5f7f6;
  --surface: #ffffff;
  --surface-2: #eef2f0;
  --fg: #1e2a27;
  --muted: #5f6b66;
  --faint: #9aa39e;
  --border: #e8ebe9;
  --border-2: #dce2df;
  --accent: #10a37a;
  --accent-strong: #0b7d5d;
  --accent-wash: #e6f5ef;
  --accent-line: #bfe6d6;
  --danger: #e0533f;
  --cream: #faf6ef;
  --cream-2: #f1e7d6;
  --ink: #3a3632;

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
  border-radius: 28rpx;
  box-shadow: 0 2rpx 10rpx rgba(30, 42, 39, 0.04);
}

.btn-primary {
  display: flex; align-items: center; justify-content: center;
  height: 92rpx; border-radius: 18rpx;
  background: var(--accent); color: #fff;
  font-size: 30rpx; font-weight: 600; letter-spacing: 0.02em;
  box-shadow: 0 6rpx 18rpx rgba(16, 163, 122, 0.22);
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
