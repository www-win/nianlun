# 统一进度条设计（miniapp）

日期：2026-07-13
分支：`feat/import-progress`
状态：已通过 brainstorm，待实现

## 背景与目标

用户诉求：**所有页面在遇到卡顿（尤其从服务器/云函数拉取）时，给一个进度条，改善等待体验。**

现状盘点（`packages/miniapp`）：

| 页面 | 等待操作 | store 状态 | 可测进度？ | 现有指示 |
|---|---|---|---|---|
| import | 解析文件 | `progress` + `phase` | ✅ | 已有真进度条（本分支成果） |
| stock | `analyzeStocks` 云函数逐个分析 | `analyzingStocks {done,total}` | ✅ | **无**（仅结束后 toast） |
| friends | 批量角色分析 | `analyzing {done,total}` | ✅ | 每行"分析中…"文字（逐个） |
| chat-qa | AI 问答 | `loading` 布尔 | ❌ | "思考中"气泡 |
| overview 备份 | 云备份/恢复 | `status` 枚举 | ❌ | 按钮原生 `:loading` 转圈 |

关键判断：
- 服务器/AI 调用大多**不可测**（无 % 回传）→ 用不确定型动画条，诚实。
- 但 stock / friends 的分析**已在回传 `{done,total}`** → 可做真进度条。
- 采用**组合方案**：可测用真进度条，不可测用动画条，统一成一套视觉语言（复用现有 import `.bar`）。
- 放置方式：**共享组件内联到各页面**（非全局顶部条、非全屏遮罩）。

## 设计

### 1. 新增共享组件 `packages/miniapp/src/components/ProgressBar.vue`

纯展示组件（无 store、无副作用），props：

- `percent?: number`（0–100）— 传了即为**可测真进度条**，`.bar-in` 宽度 = `clamp(0,100,percent)%`。
- `indeterminate?: boolean` — 为 true 时用**滑动动画条**（复用现有 `@keyframes indet`，`.bar` 加 `.indet` 类）。
- `label?: string` — 条下方一行灰字说明（如 `分析中 3/8`）；空则不渲染文字行。

**模式优先级**：传了 `percent`（`typeof percent === 'number'`）走 determinate，忽略 `indeterminate`；否则若 `indeterminate` 为 true 走动画条；两者都无则渲染一条静止空条（边界情况，调用方通常用 `v-if` 控制显隐）。

视觉 100% 沿用 import 现有样式：`--accent` 填充色、`--surface-2` 轨道、`12rpx` 高、`999rpx` 圆角、`transition: width .2s`、`@keyframes indet`（1.1s 往返）。这些 CSS 从 import.vue 迁入组件 `<style scoped>`。

### 2. import.vue 重构为使用该组件

将现有内联进度条替换：

```html
<ProgressBar
  :percent="imp.phase === 'parsing' ? pct : undefined"
  :indeterminate="imp.phase !== 'parsing'"
  :label="phaseLabel" />
```

- 删除 import.vue 中重复的 `.bar` / `.bar-in` / `.bar.indet` / `@keyframes indet` CSS。
- 三步指示器（`.steps3`）保留在 import.vue，不进组件（是 import 专属）。
- **行为必须不变**：现有 `import.test.ts` / `data.test.ts` 继续通过。

### 3. stock.vue 接入真进度条（本次体验提升最大处）

`analyzeStocks` 期间（`imp.analyzingStocks` 非空）在分析按钮下方显示：

```html
<ProgressBar
  v-if="imp.analyzingStocks"
  :percent="imp.analyzingStocks.total
    ? Math.round(imp.analyzingStocks.done / imp.analyzingStocks.total * 100) : 0"
  :label="`分析荐股 ${imp.analyzingStocks.done}/${imp.analyzingStocks.total}`" />
```

`total === 0` 时退化为 0%（保护除零）。这是当前唯一"从服务器拉取却完全无进度反馈"的地方。

### 4. 其余页面统一（保守，不破坏现有交互）

- **chat-qa**：在现有"思考中"气泡内嵌一条 `indeterminate` 细条，气泡保留；`v-if="store.loading"`。
- **overview 备份**：按钮原生 `:loading` 保留；按钮下方在 `backup.status === 'backing' || 'restoring'` 时加一条 `indeterminate` 条 + 文字（备份中/恢复中）。
- **friends 批量角色分析**：`v-if="imp.analyzing"` 时列表顶部加 determinate 条 `分析中 ${done}/${total}`。逐好友的每行"分析中…"文字保留不动。

## 测试策略（TDD）

- **组件单测（新增）** `src/components/__tests__/ProgressBar.test.ts`（jsdom + @vue/test-utils）：
  1. 传 `percent=40` → `.bar-in` 内联 `width: 40%`，无 `.indet` 类。
  2. 传 `indeterminate`（不传 percent）→ `.bar` 含 `.indet` 类，`.bar-in` 无 width 内联。
  3. 传 `label` → 渲染该文字；不传 → 无文字行。
  4. 同时传 `percent` 与 `indeterminate` → percent 优先（determinate，无 `.indet`）。
  5. `percent` 越界（-5 / 150）→ 夹到 0 / 100。
- **回归**：`import.test.ts`、`data.test.ts` 保持绿。import.vue 重构后确认三步指示器与进度行为不变（现有测试覆盖 store；模板改动薄，必要时加一条 import.vue 渲染断言）。
- 页面接入以组件单测 + 现有 store 测试为主，页面模板改动薄不新增页面级 e2e。

## 明确不做（YAGNI）

- 不做全局顶部 NProgress 条；不做全屏遮罩。
- 不给纯本地秒开的路径（overview/report/my-bazi `onLoad`、hydrate）加条——不卡。
- stock-detail 无异步，不加。

## 影响文件

- 新增：`src/components/ProgressBar.vue`、`src/components/__tests__/ProgressBar.test.ts`
- 修改：`src/pages/import/import.vue`、`src/pages/stock/stock.vue`、`src/pages/chat-qa/chat-qa.vue`、`src/pages/overview/overview.vue`、`src/pages/friends/friends.vue`
