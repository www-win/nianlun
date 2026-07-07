# 设计：AI 职务分析改为手动 + 好友列表加分析按钮

日期：2026-07-07
范围：`packages/miniapp`

## 背景

当前 AI 会**自动**推断好友的关系（rel）/职务（role）并写回，触发点有两处：

- `App.vue` 启动 `hydrate()` 后：`void useImportStore().analyzePendingRoles()`（[App.vue:27](../../../packages/miniapp/src/App.vue#L27)）。
- `import.ts` 导入完成后：`await analyzePendingRoles()`（[import.ts:123](../../../packages/miniapp/src/stores/import.ts#L123)）。

自动分析只覆盖「消息数 ≥ 20 且未分析」的好友，后台串行执行。

用户希望改为**手动**：不再自动跑，好友列表每行加一个按钮，点一下只分析那一位好友。

## 目标

1. 移除全部自动分析触发。
2. 好友列表每行加「AI 分析」按钮，点击只分析该好友。
3. 手动分析**不套用**消息数门槛（`ROLE_MIN_MSGS ≥ 20`）——尊重用户手动选中的人。
4. 保留现有批量分析机制（`analyzePendingRoles` / `analyzeRolesForNew` / `analyzedIds`）在代码里，只是不再自动调用，为将来可能的批量入口留口子。

## 非目标

- 不做列表顶部的「一键批量分析」入口（本次只做单个）。
- 不改动 `roleAnalysis.ts`（批量适配器）与其测试。
- 不改后端/云函数调用层（`aiClient.suggestFriend` 复用）。

## 改动

### 1. 移除自动触发

- 删 `App.vue` 启动后那行 `void useImportStore().analyzePendingRoles()`（及其上方注释）。
- 删 `import.ts` `run()` 里导入完成后的 `await analyzePendingRoles()`（及其行内注释）。

`analyzePendingRoles` 函数本身**保留**（仍从 store 返回），只是无人再调用。

### 2. store：新增 `analyzeOne(id)`

在 `createImportStore` 内新增：

- 状态：`const analyzingIds = ref<Set<string>>(new Set())`——记录「哪些好友正在分析中」，用于按钮 loading 与防重复点击。（每次增删都替换成新 Set 以触发响应式。）
- 方法 `analyzeOne(id: string): Promise<void>`：
  1. 若 `analyzingIds.value.has(id)` 直接 return（重入保护）。
  2. 从 `useData().friends` 找到该 friend；找不到则 return。
  3. 置入 analyzing 集合（await 前置位守卫）。
  4. `try`：`const sug = await suggest(f, loadSamples(f.id))`；若 `sug.rel || sug.role` 则 `await d.updateFriend(id, { rel: sug.rel, role: sug.role })`，并把 id 并入持久化的 `analyzedIds`（`storage.saveAnalyzedIds([...new Set([...storage.loadAnalyzedIds(), id])])`）。若无结果，用 `uni.showToast` 提示「未分析出结果」。
  5. `catch`：`uni.showToast({ title: '分析失败：' + msg, icon: 'none' })`。
  6. `finally`：从 analyzing 集合移除 id。
- 导出 `analyzingIds`、`analyzeOne`。

> 说明：`suggest` 与 `loadSamples` 已是 store 的可注入依赖（`deps.suggest` / `deps.loadSamples`），`analyzeOne` 直接复用，测试可注入假实现，无需真机。

### 3. friends.vue 加按钮

- 引入 `useImportStore`，拿 `analyzeOne` 与 `analyzingIds`。
- 在每张卡片 `.acts` 行加一个按钮：
  ```html
  <view class="act act-ai" :class="{ busy: imp.analyzingIds.has(f.id) }"
        @click="imp.analyzeOne(f.id)">
    <text class="act-t">{{ imp.analyzingIds.has(f.id) ? '分析中…' : '🪄 AI分析' }}</text>
  </view>
  ```
- 复用已存在的 `.act-ai` 样式（accent 配色，见 [friends.vue:134](../../../packages/miniapp/src/pages/friends/friends.vue#L134)）；`busy` 态降低透明度示意。

### 4. 错误/边界

- 手动操作 → 用 `uni.showToast` 即时反馈（失败、无结果），区别于后台批量的静默 warnings 累积。
- 重入保护：同一好友分析中不重复触发。

## 测试

`packages/miniapp/src/stores/__tests__/import.test.ts`：

- `analyzeOne` 成功：注入 `suggest` 返回 `{rel, role}`，断言 `data.updateFriend` 被调用、`analyzedIds` 被追加。
- `analyzeOne` 忽略门槛：msgCount < 20 的好友也会被分析（调用 suggest）。
- `analyzeOne` 重入保护：分析中再次调用不重复触发 suggest。
- `analyzeOne` 失败：suggest 抛异常时不 reject，状态（analyzingIds）复位。
- 移除自动触发后的回归：`run()` 完成后**不**再自动调用 analyzePendingRoles（调整/移除原有相关断言）。

`uni.showToast` 在测试环境需 mock（miniapp 测试已有 uni 全局的处理方式，沿用）。

## 影响面

- 用户不再看到「导入后自动补分析」的 warnings；改为逐个手动点。
- `analyzePendingRoles` 及批量适配器与其测试保持不动（死代码但保留，注释说明留待将来批量入口）。
