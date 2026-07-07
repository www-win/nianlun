# 设计：二级市场 tab（荐股查看页面）

- 日期：2026-07-07
- 范围：`packages/miniapp`
- 状态：待实现
- 上游：荐股抽取引擎 spec（`2026-07-06-miniapp-stock-extraction-design.md`，引擎已实现）、功能示意图 `docs/二级市场模块-功能示意图.html`（视觉真理来源）

## 一、背景与目标

荐股抽取引擎（core 数据模型 + 抽取 + 两个聚合视图函数 + miniapp 编排/存储）已就绪，但**没有查看 UI**——抽出来的荐股看不到。本设计做一个独立的「**二级市场**」tab（替换现有「关系网」），把「触发分析」+「查看两个交叉视图」集于一处，让荐股功能真正可用。

## 二、非目标

- 不做现价取数（数据源未定，字段占位留空）。
- 不做勾选好友 UI（几千好友「选谁分析」靠**选哪个文件**控制，见第八节）。
- **不改导入模块**（方案 A：导入不存原文；荐股在本 tab 内重选文件分析）。
- 不改荐股抽取引擎（复用 `analyzeStocks`/`loadStockPicks`/`aggregateByStock`/`aggregateByRecommender`）。
- 不做人工纠错/合并、不做重抽「替换语义」（后续迭代）。

## 三、入口与导航

- `pages.json`：删除 `pages/network/network` 的 tab 与 page 注册；新增 `pages/stock/stock`（tab 文字「二级市场」，位置接替关系网）；新增 `pages/stock-detail/stock-detail`（page，非 tab）。
- 删除 `packages/miniapp/src/pages/network/network.vue`（grep 确认无其它页面跳转它，安全）。
- `pages/import/import.vue`：**移除**「分析荐股」按钮及 `onAnalyzeStocks`（触发移到二级市场 tab）。`importStore.analyzeStocks` action 保留（本 tab 复用）。

## 四、主页 `pages/stock/stock.vue`

- **顶部**：「分析荐股」按钮（点击 → 重选文件抽取/更新）；统计行「已抽 N 条 · X 支票 · Y 人」。
- **空状态**（无荐股结果）：引导文案「还没有荐股数据。点上方「分析荐股」，选聊天文件抽取一次。」
- **两个标签切换**（`view.a` / `view.b`，默认 A）：
  - **视图 A · 以票查人**：`aggregateByStock(picks)` → `StockCard[]`，**按 `recommenderCount` 降序**（推的人越多越靠前 = 核心标的）。每张卡片：`displayName` · 「**N 人在推**」badge · `latestMultiple`（看几倍）· `latestTargetMarketCap`。点卡片 → 票详情。
  - **视图 B · 以人查票**：`aggregateByRecommender(picks)` → `RecommenderPicks[]`，按 `stockCount` 降序。每张卡片：`recommender` · 「推过 M 支票」。点卡片 → 人详情。
- 分析进行中：显示 `importStore.analyzingStocks` 进度「正在分析荐股… done/total」。

## 五、详情页 `pages/stock-detail/stock-detail.vue`

由 query 参数区分（`navigateTo`）：

- **票详情**（`?type=stock&key=<stockNorm>`）：三层卡片（对齐功能示意图）——
  - 第一层·基本盘：`displayName`、被谁推（推荐人列表）、`latestTargetMarketCap`、`latestMultiple`、现价（占位「—」）。
  - 第二层·推荐逻辑：`card.logics` 逐条。
  - 第三层·公司信息：`card.companyNotes` 逐条。
  - 底部·推荐记录：该票 `picks` 列表（推荐人 · 时间 · 看几倍 · 原话 `quote`）。
- **人详情**（`?type=person&id=<recommenderId>`）：该人 `picks` 按票聚合列表（票名 · 时间 · 看几倍）。

## 六、数据流（不新增 store 逻辑）

```
storage.loadStockPicks() → StockPick[]
   ├─ aggregateByStock(picks)        → 视图A / 票详情（core 现成）
   └─ aggregateByRecommender(picks)  → 视图B / 人详情（core 现成）
分析：stock 页「分析荐股」→ fileReader.pickAndRead → importStore.analyzeStocks(files) → 完成后重新 loadStockPicks 刷新
```

页面从 `storage.loadStockPicks()` 读原子记录，用 core 的两个聚合纯函数现场派生视图。**不持久化派生结果、不新增 store**。

## 七、分析触发（复用现成）

stock 页「分析荐股」按钮 → `fileReader.pickAndRead(500)` → `importStore.analyzeStocks(files)`（已实现：过滤联系人 → parseFile → 当场抽取 → `mergeStockPicks` 存回）。进度/统计复用 `importStore` 的 `analyzingStocks` / `stocksSavedCount`。完成后 stock 页重新 `loadStockPicks()` 刷新列表。

## 八、几千好友「选谁分析」（性能）

方案 A 下，抽取范围 = 本次**选的文件**里有会话的好友。所以「只想分析某几个首席」= 只导出/选含他们聊天的文件。**首版不做勾选 UI**；顶部按钮旁加一行小字提示「只分析所选文件里的好友」。将来可加勾选（`analyzeStocks` 的 `targetIds` 白名单已支持）。

## 九、视觉

契合现有设计系统：用 `App.vue` 的设计令牌（`--green`/`--green-l`/`--surface`/`--muted`/`--line` 等）；列表卡片、标签切换、详情三层卡片的排版参考 `pages/friends/friends.vue`（列表范式）与 `pages/friend-detail/friend-detail.vue`（卡片/分区范式）。三层卡片对齐功能示意图的「layer」样式（左侧色条 + 序号 + 标题 + chips）。

## 十、测试

- core 聚合函数（`aggregateByStock`/`aggregateByRecommender`）已在 core 单测覆盖。
- 抽出**页面无关的纯逻辑**到 `lib/stockView.ts`（排序：票按 recommenderCount 降序、人按 stockCount 降序；顶部统计：条数/票数/人数；空态判断），用 Vitest 测试。
- uni-app 页面（.vue）不强求单测，逻辑尽量下沉到 `lib/stockView.ts`。

## 十一、改动清单

- 改 `pages.json`（tab/page 增删）
- 删 `pages/network/network.vue`
- 新增 `pages/stock/stock.vue`、`pages/stock-detail/stock-detail.vue`
- 新增 `lib/stockView.ts` + `lib/__tests__/stockView.test.ts`
- 改 `pages/import/import.vue`（移除分析荐股按钮）

## 十二、交付顺序

1. `lib/stockView.ts` 纯逻辑（排序/统计/空态）+ 测试。
2. `pages.json` 换 tab + 删 `network.vue`。
3. `stock.vue` 主页（两视图列表 + 空态 + 分析触发 + 进度）。
4. `stock-detail.vue`（票/人详情，三层卡片）。
5. `import.vue` 移除分析荐股按钮。
6. `pnpm --filter @nianlun/miniapp test` 全绿 → `build:mp-weixin` → 真机验收（点二级市场 tab → 分析 → 看到两个视图）。
