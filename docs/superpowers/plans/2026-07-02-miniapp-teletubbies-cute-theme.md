# 小程序天线宝宝可爱换肤 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把微信小程序 `@nianlun/miniapp` 从「玉绿极简」全面换肤为「明快糖果色 + 蓝天绿草坡 + 原创天线小人吉祥物」的可爱风，不改任何业务逻辑。

**Architecture:** 配色集中在 `App.vue` 的 `page` CSS 变量，一处改全页受益；新增一组纯 CSS 装饰组件（天线小人、太阳、草坡）放 `components/`，逐页引用；逐页把顶部/hero 换成可爱场景，并把图表里硬编码的旧绿色 `rgba(16,163,122,…)` 换成新绿 `rgba(67,196,99,…)`；报告页 canvas 出图同步加装饰。

**Tech Stack:** uni-app (Vue 3 SFC, `<view>/<text>` 组件) + mp-weixin 编译；Vitest（仅纯逻辑测试，无组件挂载测试）。

## Global Constraints

- 仅改 `packages/miniapp`，**不动** `packages/web`、`packages/core`。
- **不使用任何受版权保护的天线宝宝官方素材/造型**；装饰全为原创 CSS `<view>` 绘制，不引图片文件。
- 主色 = 草坡绿 `#43c463`；`--accent-strong` = `#2ea34a`。四色点缀：红 `#ff6b6b`、绿 `#43c463`、黄 `#ffd23f`、紫 `#a97be0`；天空蓝 `#5ec8f5`。
- **不改业务逻辑、数据结构、Pinia store、存储键**（`nianlun:*` 保持不变）。只改样式、模板结构与新增装饰组件。
- 数据表格类页（好友/概览/关系网/好友详情）保持白底卡片 + 高对比文字，彩色只用于标签/图表/头部装饰，保证可读。
- 每个任务的验证 = `pnpm --filter @nianlun/miniapp build:mp-weixin` 编译通过 **且** `pnpm --filter @nianlun/miniapp test` 67 个测试全绿。（当前 miniapp 无组件挂载测试框架，视觉效果靠微信开发者工具目视确认，不在自动化范围内。）
- 每个任务结束提交一次；提交信息尾行加：
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- 分支：`feat/miniapp-teletubbies-theme`（已创建，品牌重命名与设计文档已提交）。

---

### Task 1: 配色令牌 + tabBar 换肤

**Files:**
- Modify: `packages/miniapp/src/App.vue:23-89`（`page` 变量与共享类）
- Modify: `packages/miniapp/src/pages.json:10-18`（tabBar 配色）

**Interfaces:**
- Consumes: 无。
- Produces: 全局 CSS 变量 `--accent`=`#43c463`、`--accent-strong`=`#2ea34a`、`--accent-wash`=`#e3f7e8`、`--accent-line`=`#bfe9c9`、`--bg`=`#eefaf0`，新增 `--sky`=`#5ec8f5`、`--po`=`#ff6b6b`、`--dipsy`=`#43c463`、`--laa`=`#ffd23f`、`--tinky`=`#a97be0`。后续所有任务依赖这些变量名。

- [ ] **Step 1: 改 `page` 配色变量**（`App.vue`）

把 `page` 选择器内的这几行替换为：

```css
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
```

- [ ] **Step 2: 卡片与按钮更圆润**（`App.vue`）

- `.card` 的 `border-radius: 28rpx;` → `border-radius: 36rpx;`
- `.btn-primary` 的 `border-radius: 18rpx;` → `border-radius: 999rpx;`，并把 `box-shadow` 改为 `0 8rpx 20rpx rgba(67, 196, 99, 0.28);`
- `.btn-primary.hover { background: var(--accent-strong); }` 保持不变。

- [ ] **Step 3: tabBar 配色**（`pages.json`）

把 `"tabBar": {` 对象改为（在 `list` 前加 4 个配色字段）：

```json
  "tabBar": {
    "color": "#9aa39e",
    "selectedColor": "#2ea34a",
    "backgroundColor": "#ffffff",
    "borderStyle": "white",
    "list": [
      { "pagePath": "pages/import/import", "text": "导入" },
      { "pagePath": "pages/overview/overview", "text": "概览" },
      { "pagePath": "pages/friends/friends", "text": "好友" },
      { "pagePath": "pages/network/network", "text": "关系网" },
      { "pagePath": "pages/report/report", "text": "报告" }
    ]
  }
```

- [ ] **Step 4: 构建 + 测试**

Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: `Build complete.`（无编译错误）

Run: `pnpm --filter @nianlun/miniapp test`
Expected: `Test Files 11 passed`、`Tests 67 passed`

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/App.vue packages/miniapp/src/pages.json
git commit -m "feat(miniapp): 换肤配色令牌(草坡绿) + 圆润卡片按钮 + tabBar 主题色"
```

---

### Task 2: 天线小人组件 `AntennaBuddy.vue`

**Files:**
- Create: `packages/miniapp/src/components/AntennaBuddy.vue`

**Interfaces:**
- Consumes: 无（自带默认色）。
- Produces: 组件 `AntennaBuddy`，props：`color?: string`（身体色，默认 `#43c463`）、`antenna?: 'triangle' | 'rod' | 'curl' | 'ring'`（默认 `'rod'`）、`scale?: number`（整体缩放，默认 `1`）。基准尺寸约 120rpx 宽、150rpx 高（含天线），`transform-origin: bottom center`。后续 Task 4–7 引用它。

- [ ] **Step 1: 写组件**

创建 `packages/miniapp/src/components/AntennaBuddy.vue`，内容：

```vue
<script setup lang="ts">
withDefaults(defineProps<{
  color?: string
  antenna?: 'triangle' | 'rod' | 'curl' | 'ring'
  scale?: number
}>(), { color: '#43c463', antenna: 'rod', scale: 1 })
</script>

<template>
  <view class="buddy" :style="{ transform: 'scale(' + scale + ')' }">
    <view class="antenna" :class="'a-' + antenna">
      <view class="stalk"></view>
      <view class="tip"></view>
    </view>
    <view class="body" :style="{ background: color }">
      <view class="face">
        <view class="eye"></view>
        <view class="eye"></view>
      </view>
      <view class="mouth"></view>
      <view class="screen"></view>
    </view>
  </view>
</template>

<style scoped>
.buddy {
  position: relative; width: 120rpx; height: 156rpx;
  transform-origin: bottom center;
}
/* 头顶天线 */
.antenna { position: absolute; left: 50%; top: 0; transform: translateX(-50%); }
.antenna .stalk { width: 6rpx; height: 40rpx; margin: 0 auto; background: #6b6b6b; border-radius: 4rpx; }
.antenna .tip { margin: -4rpx auto 0; }
/* rod：顶端小圆球 */
.a-rod .tip { width: 18rpx; height: 18rpx; border-radius: 50%; background: #6b6b6b; }
/* triangle：顶端三角 */
.a-triangle .tip {
  width: 0; height: 0; margin-top: -2rpx;
  border-left: 14rpx solid transparent; border-right: 14rpx solid transparent;
  border-bottom: 24rpx solid #6b6b6b;
}
/* ring：顶端圆环 */
.a-ring .tip { width: 30rpx; height: 30rpx; border-radius: 50%; border: 6rpx solid #6b6b6b; background: transparent; }
/* curl：顶端卷卷（半环） */
.a-curl .stalk { height: 30rpx; }
.a-curl .tip {
  width: 30rpx; height: 22rpx; margin-top: -2rpx;
  border: 6rpx solid #6b6b6b; border-bottom: none;
  border-radius: 30rpx 30rpx 0 0; background: transparent;
}
/* 身体 */
.body {
  position: absolute; left: 50%; bottom: 0; transform: translateX(-50%);
  width: 110rpx; height: 116rpx;
  border-radius: 55rpx 55rpx 48rpx 48rpx;
  box-shadow: inset 0 -8rpx 16rpx rgba(0,0,0,0.08), 0 6rpx 14rpx rgba(0,0,0,0.12);
}
.face { position: absolute; left: 0; right: 0; top: 30rpx; display: flex; justify-content: center; gap: 20rpx; }
.eye { width: 16rpx; height: 20rpx; border-radius: 50%; background: #2b2b2b; }
.mouth {
  position: absolute; left: 50%; top: 58rpx; transform: translateX(-50%);
  width: 26rpx; height: 14rpx; border: 4rpx solid #2b2b2b; border-top: none;
  border-radius: 0 0 26rpx 26rpx;
}
/* 肚子小屏幕 */
.screen {
  position: absolute; left: 50%; bottom: 14rpx; transform: translateX(-50%);
  width: 46rpx; height: 34rpx; border-radius: 10rpx;
  background: rgba(255,255,255,0.5); border: 3rpx solid rgba(255,255,255,0.75);
}
</style>
```

- [ ] **Step 2: 构建验证组件可编译**

Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: `Build complete.`（组件尚未被引用，仅验证语法可编译）

- [ ] **Step 3: 提交**

```bash
git add packages/miniapp/src/components/AntennaBuddy.vue
git commit -m "feat(miniapp): 新增原创天线小人 AntennaBuddy 组件(纯CSS)"
```

---

### Task 3: 太阳与草坡装饰组件

**Files:**
- Create: `packages/miniapp/src/components/SunBaby.vue`
- Create: `packages/miniapp/src/components/GrassHills.vue`

**Interfaces:**
- Consumes: 无。
- Produces: 组件 `SunBaby`（props：`size?: number` 直径 rpx，默认 `96`）——带笑脸的太阳；组件 `GrassHills`（props：`height?: number` rpx，默认 `120`）——底部波浪草坡。后续 Task 4–7 引用。

- [ ] **Step 1: 写 `SunBaby.vue`**

```vue
<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 96 })
</script>

<template>
  <view class="sun" :style="{ width: size + 'rpx', height: size + 'rpx' }">
    <view class="rays"></view>
    <view class="disc">
      <view class="cheek cl"></view>
      <view class="cheek cr"></view>
      <view class="eye el"></view>
      <view class="eye er"></view>
      <view class="smile"></view>
    </view>
  </view>
</template>

<style scoped>
.sun { position: relative; }
.rays {
  position: absolute; inset: -18%;
  border-radius: 50%;
  background: radial-gradient(circle, #ffd23f 60%, rgba(255,210,63,0) 61%);
  filter: blur(1rpx);
}
.disc {
  position: absolute; inset: 8%;
  border-radius: 50%; background: #ffcf33;
  box-shadow: inset 0 -6rpx 12rpx rgba(230,160,0,0.3);
}
.cheek { position: absolute; top: 55%; width: 18%; height: 12%; border-radius: 50%; background: #ff9db0; opacity: 0.8; }
.cl { left: 14%; } .cr { right: 14%; }
.eye { position: absolute; top: 38%; width: 10%; height: 16%; border-radius: 50%; background: #6b4a00; }
.el { left: 32%; } .er { right: 32%; }
.smile {
  position: absolute; left: 50%; top: 52%; transform: translateX(-50%);
  width: 34%; height: 20%; border: 4rpx solid #6b4a00; border-top: none;
  border-radius: 0 0 40rpx 40rpx;
}
</style>
```

- [ ] **Step 2: 写 `GrassHills.vue`**

```vue
<script setup lang="ts">
withDefaults(defineProps<{ height?: number }>(), { height: 120 })
</script>

<template>
  <view class="hills" :style="{ height: height + 'rpx' }">
    <view class="hill h1"></view>
    <view class="hill h2"></view>
    <view class="hill h3"></view>
  </view>
</template>

<style scoped>
.hills { position: relative; width: 100%; overflow: hidden; }
.hill { position: absolute; bottom: -40rpx; border-radius: 50%; }
.h1 { left: -10%; width: 55%; height: 200rpx; background: #7fd694; }
.h2 { right: -8%; width: 50%; height: 220rpx; background: #5fc47a; }
.h3 { left: 28%; width: 48%; height: 180rpx; background: #43c463; }
</style>
```

- [ ] **Step 3: 构建**

Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: `Build complete.`

- [ ] **Step 4: 提交**

```bash
git add packages/miniapp/src/components/SunBaby.vue packages/miniapp/src/components/GrassHills.vue
git commit -m "feat(miniapp): 新增太阳 SunBaby + 草坡 GrassHills 装饰组件"
```

---

### Task 4: 导入页欢迎场景

**Files:**
- Modify: `packages/miniapp/src/pages/import/import.vue`（`<template>` 的 `.hero` 块与 `<style>`）

**Interfaces:**
- Consumes: Task 2 `AntennaBuddy`、Task 3 `SunBaby`/`GrassHills`；变量 `--sky`/`--po`/`--laa`/`--tinky`/`--dipsy`。
- Produces: 无下游依赖。

- [ ] **Step 1: 引入组件**

在 `<script setup>` 顶部（`import { ref, computed } from 'vue'` 之后）加：

```ts
import AntennaBuddy from '../../components/AntennaBuddy.vue'
import SunBaby from '../../components/SunBaby.vue'
import GrassHills from '../../components/GrassHills.vue'
```

- [ ] **Step 2: 替换 hero 块**

把模板里从 `<view class="hero">` 到其闭合 `</view>`（当前 `import.vue:31-40`，含 `.rings` 三个圈）整体替换为：

```html
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
```

- [ ] **Step 3: 替换 hero 样式**

在 `<style scoped>` 中，把 `.hero` / `.rings` / `.ring*` 相关规则（当前 `import.vue:108-113`）替换为：

```css
.hero {
  position: relative; text-align: center;
  padding: 36rpx 0 40rpx; margin-bottom: 8rpx;
  background: linear-gradient(180deg, #d6f0ff 0%, #eefaf0 78%);
  border-radius: 40rpx;
}
.hero .sun { position: absolute; top: 24rpx; right: 40rpx; }
.buddies { display: flex; align-items: flex-end; justify-content: center; gap: 4rpx; padding-top: 24rpx; height: 150rpx; }
.hero .hills { margin-top: -20rpx; }
```

`.title`/`.subtitle`/`.privacy` 保持原样（Task 1 已给出全局圆润与配色，`.title` 的 `letter-spacing: 0.08em` 可保留）。

- [ ] **Step 4: 构建 + 测试**

Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: `Build complete.`

Run: `pnpm --filter @nianlun/miniapp test`
Expected: `Tests 67 passed`

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/pages/import/import.vue
git commit -m "feat(miniapp): 导入页换成太阳+草坡+四小人欢迎场景"
```

---

### Task 5: 概览 / 好友 / 关系网 顶部装饰 + 图表配色

**Files:**
- Modify: `packages/miniapp/src/pages/overview/overview.vue`
- Modify: `packages/miniapp/src/pages/friends/friends.vue`
- Modify: `packages/miniapp/src/pages/network/network.vue`

**Interfaces:**
- Consumes: Task 2 `AntennaBuddy`；新绿 `rgba(67,196,99,…)`。
- Produces: 无下游依赖。

- [ ] **Step 1: overview 顶部加小人 + 修热力图绿色**

在 `overview.vue` `<script setup>` 顶部加：`import AntennaBuddy from '../../components/AntennaBuddy.vue'`

把 `.head` 块（`overview.vue:69-72`）替换为：

```html
      <view class="head">
        <view class="head-l">
          <text class="eyebrow">年度概览</text>
          <text class="year num">{{ data.report.year }}</text>
        </view>
        <AntennaBuddy :color="'var(--dipsy)'" antenna="rod" :scale="0.66" />
      </view>
```

把 `.head` 样式（`overview.vue:165`）替换为：

```css
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28rpx; }
.head-l { display: flex; flex-direction: column; }
```

把热力图单元格里两处硬编码的 `'rgba(16,163,122,' + cellAlpha(c) + ')'`（`overview.vue:151`）改为 `'rgba(67,196,99,' + cellAlpha(c) + ')'`。

- [ ] **Step 2: friends 顶部加小人**

在 `friends.vue` `<script setup>` 顶部加：`import AntennaBuddy from '../../components/AntennaBuddy.vue'`

把 `<text class="count faint">共 {{ rows.length }} 位好友</text>`（`friends.vue:56`）替换为：

```html
      <view class="count-row">
        <text class="count faint">共 {{ rows.length }} 位好友</text>
        <AntennaBuddy :color="'var(--laa)'" antenna="curl" :scale="0.5" />
      </view>
```

在 `<style scoped>` 末尾追加：

```css
.count-row { display: flex; align-items: center; justify-content: space-between; }
```

（`friends.vue` 的 `.avatar`/`.tag` 已用 `relColor`，保持原样即可。）

- [ ] **Step 3: network 修「我」节点绿色阴影**

`network.vue` 的 `.me` 用了 `box-shadow: 0 6rpx 18rpx rgba(16, 163, 122, 0.3);`（`network.vue:103`），改为 `rgba(67, 196, 99, 0.34);`。其余（`REL_COLORS` 关系色）保持。

- [ ] **Step 4: 构建 + 测试**

Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: `Build complete.`

Run: `pnpm --filter @nianlun/miniapp test`
Expected: `Tests 67 passed`

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/pages/overview/overview.vue packages/miniapp/src/pages/friends/friends.vue packages/miniapp/src/pages/network/network.vue
git commit -m "feat(miniapp): 概览/好友/关系网 顶部小人角标 + 图表改用新绿"
```

---

### Task 6: 好友详情头部装饰 + 图表配色

**Files:**
- Modify: `packages/miniapp/src/pages/friend-detail/friend-detail.vue`

**Interfaces:**
- Consumes: Task 2 `AntennaBuddy`；新绿 `rgba(67,196,99,…)`。
- Produces: 无下游依赖。

- [ ] **Step 1: 头部加小人 + 修热力图绿色**

在 `<script setup>` 顶部加：`import AntennaBuddy from '../../components/AntennaBuddy.vue'`

把头部卡片 `.head`（`friend-detail.vue:102-109`）替换为：

```html
      <view class="card head">
        <AntennaBuddy class="head-buddy" :color="relColor(friend.rel)" antenna="rod" :scale="0.6" />
        <view class="avatar" :style="{ background: relColor(friend.rel) }">{{ initials(friend.alias || friend.name) }}</view>
        <text class="name">{{ friend.alias || friend.name }}</text>
        <view class="tags">
          <view class="tag" :style="{ background: relColor(friend.rel) }">{{ friend.rel }}</view>
          <text v-if="friend.role" class="role-tag">{{ friend.role }}</text>
        </view>
      </view>
```

把热力图单元格 `'rgba(16,163,122,' + cellAlpha(c) + ')'`（`friend-detail.vue:149`）改为 `'rgba(67,196,99,' + cellAlpha(c) + ')'`。

- [ ] **Step 2: 头部样式**

把 `.head` 样式（`friend-detail.vue:218`）替换为：

```css
.head { position: relative; display: flex; flex-direction: column; align-items: center; padding: 44rpx 32rpx; overflow: hidden; }
.head-buddy { position: absolute; top: 10rpx; right: 20rpx; opacity: 0.9; }
```

- [ ] **Step 3: 构建 + 测试**

Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: `Build complete.`

Run: `pnpm --filter @nianlun/miniapp test`
Expected: `Tests 67 passed`

- [ ] **Step 4: 提交**

```bash
git add packages/miniapp/src/pages/friend-detail/friend-detail.vue
git commit -m "feat(miniapp): 好友详情头部加小人角标 + 热力图改用新绿"
```

---

### Task 7: 报告页海报装饰（DOM + canvas 出图）

**Files:**
- Modify: `packages/miniapp/src/pages/report/report.vue`

**Interfaces:**
- Consumes: Task 2 `AntennaBuddy`、Task 3 `SunBaby`/`GrassHills`。
- Produces: 无下游依赖。

- [ ] **Step 1: 引入组件 + DOM 海报加装饰**

在 `<script setup>` 顶部加：

```ts
import AntennaBuddy from '../../components/AntennaBuddy.vue'
import SunBaby from '../../components/SunBaby.vue'
import GrassHills from '../../components/GrassHills.vue'
```

在 DOM 海报 `.poster` 里，`<text class="p-foot">…</text>`（`report.vue:157`）之前插入草坡 + 四小人页脚：

```html
        <view class="p-scene">
          <SunBaby class="p-sun" :size="72" />
          <view class="p-buddies">
            <AntennaBuddy :color="'var(--tinky)'" antenna="triangle" :scale="0.5" />
            <AntennaBuddy :color="'var(--dipsy)'" antenna="rod" :scale="0.58" />
            <AntennaBuddy :color="'var(--laa)'" antenna="curl" :scale="0.58" />
            <AntennaBuddy :color="'var(--po)'" antenna="ring" :scale="0.5" />
          </view>
          <GrassHills :height="72" />
        </view>
```

在 `<style scoped>` 追加：

```css
.p-scene { position: relative; margin-top: 32rpx; }
.p-sun { position: absolute; top: -8rpx; right: 8rpx; }
.p-buddies { display: flex; align-items: flex-end; justify-content: center; gap: 2rpx; height: 96rpx; }
```

- [ ] **Step 2: canvas 出图同步画装饰**

在 `draw()` 里，`ctx.draw()`（`report.vue:111`）之前插入一段「草坡 + 太阳 + 四色小人」的绘制。把 `ctx.fillText('本地生成…', 56, CH - 60)` 保留，在它之前插入：

```js
  // 底部草坡（三段圆弧）
  const hillY = CH - 130
  const hills = [['#7fd694', 120, 90], ['#43c463', 300, 100], ['#5fc47a', 470, 84]]
  hills.forEach(([c, cx, r]) => {
    ctx.setFillStyle(c); ctx.beginPath()
    ctx.arc(cx, hillY + 60, r, Math.PI, 2 * Math.PI); ctx.fill()
  })
  // 太阳
  ctx.setFillStyle('#ffcf33'); ctx.beginPath(); ctx.arc(CW - 90, 150, 30, 0, 2 * Math.PI); ctx.fill()
  // 四色小人（圆身 + 天线杆）
  const buddies = [['#a97be0', 180], ['#43c463', 270], ['#ffd23f', 360], ['#ff6b6b', 450]]
  buddies.forEach(([c, bx]) => {
    ctx.setStrokeStyle('#6b6b6b'); ctx.setLineWidth(3)
    ctx.beginPath(); ctx.moveTo(bx, hillY - 16); ctx.lineTo(bx, hillY - 44); ctx.stroke()
    ctx.setFillStyle(c); ctx.beginPath(); ctx.arc(bx, hillY + 6, 22, 0, 2 * Math.PI); ctx.fill()
  })
```

（说明：canvas 与真机坐标以 `CW=600 / CH=860` 为基准；小人排在草坡线 `hillY` 上，太阳在右上。）

- [ ] **Step 3: 构建 + 测试**

Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: `Build complete.`

Run: `pnpm --filter @nianlun/miniapp test`
Expected: `Tests 67 passed`

- [ ] **Step 4: 提交**

```bash
git add packages/miniapp/src/pages/report/report.vue
git commit -m "feat(miniapp): 报告页海报(DOM+canvas)加草坡/太阳/四小人装饰"
```

---

### Task 8: 整体验收

**Files:** 无改动（仅验证）。

- [ ] **Step 1: 全量构建**

Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: `Build complete.` + `[postbuild-cloud] …`

- [ ] **Step 2: 全量测试**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: `Test Files 11 passed`、`Tests 67 passed`

- [ ] **Step 3: 目视确认（人工）**

打开微信开发者工具 → 导入项目目录 `packages/miniapp/dist/build/mp-weixin` → 清缓存重新编译 → 逐页确认：导入页欢迎场景、tabBar 绿色高亮、各页顶部小人、报告页海报 + 保存到相册出图带装饰。此步不在自动化范围。

---

## 备注

- `REL_COLORS`（关系色）在 overview/friends/network/friend-detail 各有一份，本次不做去重重构（超出换肤范围），保持现状。
- 若某装饰组件在真机（mp-weixin）下 CSS 表现与开发者工具不一致（如 `filter: blur` 兼容性），以真机为准微调 `SunBaby` 的 `.rays`；不影响其余任务。
