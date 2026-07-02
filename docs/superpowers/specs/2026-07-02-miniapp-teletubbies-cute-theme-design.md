# 小程序「天线宝宝」可爱换肤设计

- 日期：2026-07-02
- 范围：仅 `packages/miniapp`（微信小程序），不动 web 端
- 目标：把小程序从「玉绿极简」全面换肤为「明快糖果色 + 蓝天绿草坡 + 原创天线小人吉祥物」的可爱风

## 版权约束（重要）

天线宝宝（Teletubbies）为受版权保护的形象。**不使用官方角色造型、图片或精确复刻的角色相貌**。本设计只做**原创的、氛围神似**的可爱装饰：圆滚滚的小天线人、带笑脸的太阳、绿草坡、云朵气泡，全部用 CSS/`view` 绘制，不引入任何图片素材。

## 1. 配色令牌（`packages/miniapp/src/App.vue` 的 `page` 变量）

草坡绿为主，明快糖果色，新增四色点缀 + 天空蓝：

| 令牌 | 换成 | 用途 |
|---|---|---|
| `--accent` | `#43c463`（草坡绿） | 主按钮 / 进度条 / 高亮 |
| `--accent-strong` | `#2ea34a` | hover / 深色强调文字 |
| `--accent-wash` | 浅绿 `#e3f7e8` | 徽标底 / 弱强调块 |
| `--accent-line` | `#bfe9c9` | 弱强调描边 |
| `--bg` | `#eefaf0`（浅草绿） | 页面底色 |
| `--sky`（新） | `#5ec8f5`（天空蓝） | 背景渐变、天空带 |
| `--po` / `--dipsy` / `--laa` / `--tinky`（新） | 红 `#ff6b6b` / 绿 `#43c463` / 黄 `#ffd23f` / 紫 `#a97be0` | 四色小人 & 标签/图表分类色 |

圆角更圆润：卡片 `36rpx`，主按钮改 `999rpx` 胶囊。

数据表格页（好友 / 概览 / 关系网）保持白底卡片 + 高对比文字，仅在标签、图表、表头处用彩色，保证可读性。

## 2. 原创吉祥物系统（`packages/miniapp/src/components/`，全 CSS）

- **`AntennaBuddy.vue`**：可复用的小天线人。圆身 + 肚子小屏幕 + 头顶天线。props：`color`（四色之一）、`antenna`（`triangle` | `rod` | `curl` | `ring`）、`size`。
- **`SunBaby.vue`**：带笑脸的太阳（CSS 圆 + 光芒），角落点缀。
- **`GrassHills.vue`**：底部一条 CSS 波浪草坡（大弧 `border-radius`）。
- **`SkyClouds.vue`**（或用简单圆点）：浅色云朵/气泡背景装饰。

均为纯 `view` + CSS，不引图片，包体不增大，不触碰版权形象。

## 3. 逐页处理

- **导入页 `import.vue`**：把现有三同心圆 hero 换成「太阳 + 草坡 + 四只小人排排站」欢迎场景；标题「天线宝宝」；主按钮大胶囊；帮助卡片圆润化。
- **概览 `overview.vue` / 好友 `friends.vue` / 关系网 `network.vue`**：顶部加一条天空→草坡浅渐变带 + 一只对应色小人角标；卡片圆润；标签四色；图表分类色改用四色板。
- **好友详情 `friend-detail.vue`**：头部加小人角标；关系用彩色胶囊标签。
- **报告页 `report.vue`**：海报顶部保留「天线宝宝 · TELETUBBIES」品牌行，加太阳 + 草坡 + 四小人页脚装饰；**canvas 导出图**里也画上同款装饰，保证分享出去好看。

## 4. tabBar（`packages/miniapp/src/pages.json`）

`tabBar` 增加 `selectedColor`（草坡绿 `#2ea34a`）、`color`（灰 `#9aa39e`）、`backgroundColor`（米白 `#ffffff`）、`borderStyle: white`。文字型 tab 保持不变。

## 5. 落地与测试

- 配色令牌集中在 App.vue，一处改全页受益。
- 吉祥物/太阳/草坡做成可复用组件，逐页引用，避免重复 CSS。
- 只改样式 + 新增装饰组件，不动业务逻辑；现有 67 个测试应保持全绿。
- 新增装饰组件补一个渲染冒烟测试。
- 验收：`pnpm --filter @nianlun/miniapp test` 全绿；`build:mp-weixin` 构建通过；微信开发者工具里导入 `dist/build/mp-weixin` 目视确认各页换肤生效。

## 范围之外

- web 端（`packages/web`）不动。
- 不改业务逻辑、数据结构、存储键。
- 不使用任何受版权保护的天线宝宝官方素材。
