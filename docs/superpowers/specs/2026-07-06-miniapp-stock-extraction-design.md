# 设计：二级市场荐股抽取引擎（地基：数据模型 + core 抽取 + 编排 + 持久化）

- 日期：2026-07-06
- 范围：`packages/core`（纯逻辑）、`packages/miniapp`（编排 + 存储）
- 目标读者：本仓库开发者
- 状态：待实现
- 上游需求：[客户需求整理-2026-07-02-二级市场与好友分类分析.md](../../客户需求整理-2026-07-02-二级市场与好友分类分析.md)、[二级市场模块-大白话功能说明.md](../../二级市场模块-大白话功能说明.md)
- 前置地基：[2026-07-03-miniapp-persist-raw-chat-design.md](2026-07-03-miniapp-persist-raw-chat-design.md)（全年原文已留存本机，本 spec 直接读回消费）

## 一、背景与目标

客户（上海投资圈用户）与各路首席在微信里聊股票，聊天记录里散落大量「谁推了什么票、逻辑是什么、看几倍」。二级市场模块要把这些散落的荐股**抽成结构化、可反查的「荐股数据库」**，支持两个交叉视图：以票查人（找核心标的）、以人查票（看某人战绩）。

完整二级市场模块 = 荐股抽取引擎 + 数据模型 + 持久化 + 两个视图 UI + 现价数据源对接。范围过大，已分解。**本 spec 只做地基**：数据模型、core 抽取纯函数、miniapp 抽取编排、结果持久化。**不含 UI 页面**（另走一份 spec）。

**目标**：导入过全年聊天后，用户在导入页点「分析荐股」，系统读回本机留存的原文，对金融/投资类好友的会话逐个调 AI 抽取荐股记录，持久化结构化结果，供将来 UI 视图直接读用。

## 二、非目标（本 spec 不做）

- 不做两个交叉视图的 **UI 页面**（另走 spec；本 spec 只交付到「可被 UI 调用的编排接口 + 持久化数据」）。
- 不做**现价取数**：客户「咱们的数据库」数据源未定（需求稿待确认清单第 3 条）。`currentPrice` 字段预留、恒空。
- 不新增好友「领域分类（金融/政府/产业）」模块：那是独立模块。本 spec 用「白名单 + role 启发式」圈定候选好友（见第七节）。
- 不改 `@nianlun/core` 的纯函数边界（不碰 `window`/DOM/`Date` 时区陷阱）。
- 不做增量抽取：本次为覆盖式全量重抽（荐股记录量级小，简单优先）。
- 不做加密、不做跨设备同步（数据仅存本机、绝不上传）。

## 三、隐私说明

荐股抽取读回的是**本机留存的全年原文**（前置地基已放开「原文落盘」，客户明确要求复用）。抽取产出的荐股结构化结果同样**仅存本机、绝不上传**；AI 调用经既有 `aiProxy` 云函数（与现有画像/情绪分析同一通道），仅传该好友会话片段用于抽取。

## 四、关键决策（已与需求方对齐）

| 决策点 | 结论 | 理由 |
|---|---|---|
| 本 spec 范围 | 地基优先：数据模型 + core 抽取 + 编排 + 持久化，**不含 UI** | 地基可独立单测；UI 依赖它，另走 spec |
| 抽取粒度 | **按好友会话逐个抽**（必要时按长度再分块） | 贴合现有 `roleAnalysis` 串行逐好友范式；天然带「谁推的」（会话对方=推荐人）；可按候选筛选省 token |
| 抽取覆盖 | **仅金融/投资类候选好友** | 大幅省 token、准确率高 |
| 触发时机 | **导入页手动按钮**触发 | 抽取慢且耗 token，用户可控、可重试，契合现有分批分析交互 |
| 金融类判定 | **编排层收 `targetIds` 白名单 + `role` 关键词启发式默认** | 现无「领域分类」字段；解耦判定、不阻塞、不拉入新模块 |
| 数据模型 | **扁平原子 `StockPick[]` 为唯一事实源，视图纯函数派生** | 贴合 core 既有风格（`Conversation[]`→`Friend[]`/`ReportData` 皆派生）；零一致性负担 |
| 现价 | 字段预留、**恒空**，将来数据库补 | 数据源未定 |

## 五、数据模型（`@nianlun/core`，新增 `src/ai/stock.ts`）

### 5.1 原子记录（唯一事实源）

```ts
/** 一条荐股原子记录 = 一次「谁推了哪支票」。唯一事实源，持久化的就是它的数组。 */
export interface StockPick {
  stock: string            // 股票名（AI 按原文所述，如「江化微」）
  stockNorm: string        // 规范化名（归并键，见 normalizeStockName）
  recommenderId: string    // 推荐人好友 id（= 会话 id，编排层注入，AI 不产出）
  recommender: string      // 推荐人显示名（编排层注入）
  ts: number               // 推荐时间(毫秒)。AI 的 date 线索解析所得，取不到用会话 fallbackTs
  targetMarketCap?: string // 目标市值「500亿」
  multiple?: string        // 涨幅倍数「2倍」
  targetTime?: string      // 预计到达时间「1年内」
  currentPrice?: string    // 现价：本 spec 恒空，预留将来数据库补
  logics: string[]         // 第二层·推荐逻辑，分条
  companyNotes: string[]   // 第三层·公司信息 + 谁说了啥，分条
  quote?: string           // 原话摘录，供溯源
}
```

### 5.2 派生视图类型（纯函数产出，**不持久化**）

```ts
/** 视图A·以票查人：一支票的完整档案（三层信息在此聚合）。 */
export interface StockCard {
  stockNorm: string
  displayName: string          // 展示名：该票 picks 里最高频的 stock 写法
  recommenderCount: number     // 有多少人在推 → 核心标的指标
  pickCount: number            // 荐股记录条数
  latestTargetMarketCap?: string // 第一层·基本盘：最新一次的目标市值
  latestMultiple?: string        // 第一层·基本盘：最新一次的倍数
  logics: string[]             // 第二层：全部 picks 的 logics 去重合并
  companyNotes: string[]       // 第三层：全部 picks 的 companyNotes 合并
  picks: StockPick[]           // 该票全部荐股记录（含各推荐人各自数据）
}

/** 视图B·以人查票：某人推过的所有票。 */
export interface RecommenderPicks {
  recommenderId: string
  recommender: string
  stockCount: number           // 推过多少支不同的票（按 stockNorm 去重）
  picks: StockPick[]
}
```

### 5.3 纯函数清单（全部无副作用、容错、永不抛）

| 函数 | 签名 | 职责 |
|---|---|---|
| `normalizeStockName` | `(raw: string) => string` | 归并键规范化：trim、去空格/全角括号及内容/常见后缀，统一大小写 |
| `buildStockExtractionPrompt` | `(friend: Friend, samples: string[]) => string` | 三段式 prompt，要求 AI 输出 `StockPick` 数组的严格 JSON |
| `parseStockExtraction` | `(text: string, ctx: ExtractCtx) => StockPick[]` | 容错解析 AI 文本，注入 `recommenderId/recommender/stockNorm/ts` |
| `mergeStockPicks` | `(existing: StockPick[], incoming: StockPick[]) => StockPick[]` | 去重合并，键 `stockNorm\|recommenderId\|ts\|quote` |
| `aggregateByStock` | `(picks: StockPick[]) => StockCard[]` | 视图A；按 `stockNorm` 聚合，`recommenderCount` 按不同 `recommenderId` 计 |
| `aggregateByRecommender` | `(picks: StockPick[]) => RecommenderPicks[]` | 视图B；按 `recommenderId` 聚合 |

```ts
export interface ExtractCtx {
  recommenderId: string   // 会话 id
  recommender: string     // 会话对方显示名
  fallbackTs: number      // date 解析失败时的兜底推荐时间（会话时间中值）
}
```

## 六、core 抽取纯函数细节

### 6.1 `buildStockExtractionPrompt`

仿 `buildFriendProfilePrompt` 三段式，差异是**输出为数组**：

- 明确要求：「只输出严格的 JSON 数组，不要任何解释、不要代码围栏外文字」；**该好友全程未聊荐股就输出 `[]`**。
- 每个元素只让 AI 产出可从原文读到的字段：`stock`、`date`（原文时间线索如「3月」「2026-03」，可空）、`targetMarketCap`、`multiple`、`targetTime`、`logics`（字符串数组）、`companyNotes`（字符串数组，含「谁说了什么」的评价）、`quote`（原话摘录）。
- **不让 AI 产出** `recommenderId`/`recommender`/`stockNorm`/`ts`/`currentPrice`（由解析/编排层注入或留空），避免编造。
- 约束写进 prompt：无明确荐股不臆造；目标价/倍数宁缺毋填；`quote` 尽量摘原话。

### 6.2 样本格式（带时间戳）

编排层把会话消息渲染为带日期前缀的行，给 AI 引用时间的能力：

```
2026-03-05 对方：江化微可以重点看，现在40块，能到500亿，MOC涨价逻辑，看2倍
2026-03-05 我：好的，我看看
```

（现有画像/建议样本是 `对方：xxx`，本模块额外加 `YYYY-MM-DD ` 前缀。）

### 6.3 `parseStockExtraction`（容错，永不抛）

1. 定位首个 `[` 与末个 `]`，取子串 `JSON.parse`；失败或结果非数组 → 返回 `[]`。
2. 逐元素清洗：非对象或**无非空 `stock`** → 丢弃；`logics`/`companyNotes` 归一为「非空字符串数组」（非数组或缺失 → `[]`）；可选字符串字段取非空 trim 否则省略。
3. 注入：`recommenderId`/`recommender` 取自 `ctx`；`stockNorm = normalizeStockName(stock)`。
4. **时间**：把 AI 的 `date` 解析为毫秒 `ts`，支持 `YYYY` / `YYYY-MM` / `YYYY-MM-DD`（纯数字拼装，不依赖平台 `Date` 时区）；解析不出 → `ts = ctx.fallbackTs`。

### 6.4 聚合纯函数

- `aggregateByStock`：`groupBy(stockNorm)`；`displayName` 取组内 `stock` 出现最多的写法；`recommenderCount` = 组内不同 `recommenderId` 数；`latestTargetMarketCap`/`latestMultiple` 取组内 `ts` 最大且该字段非空的一条；`logics`/`companyNotes` 跨组去重合并。
- `aggregateByRecommender`：`groupBy(recommenderId)`；`stockCount` = 组内不同 `stockNorm` 数。

## 七、miniapp 编排 + 分块 + 金融判定

### 7.1 编排 `packages/miniapp/src/adapters/stockAnalysis.ts`

仿 `roleAnalysis.ts` 的「串行 + 容错 + 进度 + 统计」范式。依赖注入、可测（不依赖真实 wx/Worker）：

```ts
export interface AnalyzeStocksDeps {
  conversations: Conversation[]        // 由 loadRawFiles → parseFile → mergeConversations 得到
  friends: Friend[]                    // 用于取显示名 & role 启发式
  targetIds?: string[]                 // 白名单：将来 UI 勾选；给了就以它为准
  isFinanceFriend?: (f: Friend) => boolean  // 未给白名单时的候选判定；默认 role 关键词启发式
  extract: (friend: Friend, samples: string[]) => Promise<StockPick[]>  // 封装 build→transport→parse
  onProgress?: (done: number, total: number) => void
}

export interface AnalyzeStocksResult {
  picks: StockPick[]     // 全部候选好友抽取并 merge 后的记录
  analyzed: number       // 实际抽取的候选好友数
  withPicks: number      // 抽到 ≥1 条荐股的好友数
  failed: number         // 调用抛异常的好友数
  firstError?: string
}
```

流程：
1. 候选好友 = `targetIds` 存在则按之筛，否则 `friends.filter(isFinanceFriend)`。
2. 对每个候选好友，取其会话消息 → 按 6.2 渲染为带时间戳样本行。
3. **分块**：样本按字符预算切段（默认单段 ≤ ~6000 字符，留 AI 输入余量），逐段 `extract` → `mergeStockPicks` 累积（会话内跨段去重）。
4. 串行执行、`onProgress`、异常计入 `failed` 不中断，最终跨好友再 `mergeStockPicks` 汇总。

### 7.2 金融类默认判定 `isFinanceRole`

编排模块内提供默认启发式（`targetIds` 未给时用）：`friend.role` / `friend.alias` / `friend.name` 命中关键词即候选——`首席|投资|私募|券商|基金|研究员|分析师|资管|证券|操盘|游资|股|经济学家` 等。白名单（UI 勾选）永远优先于启发式。

### 7.3 AI 客户端接线 `adapters/aiClient.ts`

新增 `extractStocks(friend, samples)`：`transport(buildStockExtractionPrompt(friend, samples), maxTokens)` → `parseStockExtraction(text, ctx)`。`maxTokens` 取较大值（如 2048，荐股数组可能多条）。`ctx.fallbackTs` 由编排层按会话消息时间中值提供。

## 八、存储（`packages/miniapp/src/adapters/storage.ts`）

复用已实现的**分块机制**（`saveRawFiles` 同款：索引键 + 数据块，绕过单键 1MB 上限）：

- `saveStockPicks(picks: StockPick[]): void` — 覆盖式（先清旧块）。
- `loadStockPicks(): StockPick[]` — 读回拼接，无数据/损坏 → `[]`（容错）。
- `clearStockPicks(): void`；`clearAll()` 追加调用它。

荐股记录几百条、约几百 KB，连同现有数据仍在 10MB 内。写入包 try/catch，超限只告警、不阻断（同原文留存的容错策略）。

## 九、测试（Vitest，TDD）

**core（`packages/core/src/ai/__tests__/stock.test.ts`）**：
1. `normalizeStockName`：空格/括号/后缀/大小写归一，同票不同写法归同键。
2. `parseStockExtraction`：正常数组往返；剥围栏/前后噪声后仍解析；非数组/坏 JSON → `[]`；丢弃无 `stock` 项；`logics/companyNotes` 归一；`date` 解析 `YYYY`/`YYYY-MM`/`YYYY-MM-DD`；解析失败回退 `fallbackTs`；注入 `recommenderId/stockNorm`。
3. `mergeStockPicks`：去重键生效、保序累加。
4. `aggregateByStock`：`recommenderCount` 按不同人计、`displayName` 取高频写法、`latest*` 取最新非空。
5. `aggregateByRecommender`：`stockCount` 按不同 `stockNorm` 计。
6. `buildStockExtractionPrompt`：含关键约束串、无荐股输出 `[]` 的指示、样本编号。

**miniapp 编排（`src/adapters/__tests__/stockAnalysis.test.ts`）**：
7. 仅候选好友被 `extract`（白名单优先；无白名单走 `isFinanceRole`）。
8. 超长会话被分块多次 `extract` 且结果 `merge` 去重。
9. 某好友 `extract` 抛异常 → 计入 `failed`、不中断、`firstError` 记录。
10. `onProgress` 单调推进到 `total`。

**miniapp 存储（`src/adapters/__tests__/storage.test.ts` 增补）**：
11. `saveStockPicks`/`loadStockPicks` 往返（含跨块大数据）。
12. 无数据/损坏索引 → `[]`；`clearAll()` 后为 `[]`。

## 十、风险与回滚

- **AI 抽取质量**（最大风险）：口语化荐股、同票多写法、跨段割裂。缓解：`normalizeStockName` 归并 + `quote` 溯源 + 覆盖式重抽可迭代 prompt；UI 阶段再加人工合并/纠错。
- **token 成本**：仅金融候选 + 手动触发 + 分块预算控制；`onProgress` 让进度可见、失败可重试。
- **存储配额**：结果小（几百 KB），分块 + try/catch 告警不阻断。
- **回滚**：core 新增 `ai/stock.ts`（独立文件，不改现有导出行为）；miniapp 新增 `stockAnalysis.ts` + `aiClient`/`storage` 增量方法 + 导入页一个按钮。回滚即移除新增文件/方法/按钮；已存荐股由 `clearStockPicks`/`clearAll` 清理。

## 十一、交付顺序（TDD）

1. core：`normalizeStockName` → `parseStockExtraction` → `merge/aggregate` → `buildStockExtractionPrompt`（先测后实现），`pnpm --filter @nianlun/core test` 绿。
2. core `src/index.ts` 导出新类型/函数。
3. miniapp：`storage` 荐股读写（分块往返测试→实现）。
4. miniapp：`aiClient.extractStocks` + `stockAnalysis` 编排（编排测试→实现）。
5. 导入页「分析荐股」按钮接线（调用编排 → `saveStockPicks`，显示统计），`pnpm --filter @nianlun/miniapp test` 绿。

## 十二、将来（后续 spec，不在本 spec）

- **两个交叉视图 UI**：以票查人（核心标的排序）、以人查票（战绩）；三层卡片渲染；人工合并同票/纠错。
- **现价对接**：客户数据源确定后，按 `stockNorm` 批量补 `currentPrice`。
- **好友领域分类模块**：产出 finance/gov/industry/other 标签，替换 role 启发式判定。
