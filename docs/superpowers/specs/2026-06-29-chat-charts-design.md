# 聊天图表功能设计：时段柱状图 / 周×时热力图 / 词频统计

- 日期：2026-06-29
- 状态：已通过头脑风暴确认，待评审
- 涉及包：`@nianlun/core`、`@nianlun/web`

## 一、目标

为「年轮」新增三类可视化，**全局年度** + **单好友下钻** 两个层面都提供：

1. **时段柱状图**：按小时(0–23)统计消息数，看作息/活跃时段。
2. **周×时热力图**：星期几 × 小时(7×24=168 格)网格，看"周末晚上最活跃"这类规律。
3. **词频统计**：中文分词后的高频词排行。

## 二、关键约束（既有架构，不可破坏）

- **单向依赖** `web → core`；core 纯 TS，`lib: ES2020`、`types: []`，不碰 `window/document/IndexedDB/vue`。
- **隐私**：原始 `Conversation[]` 绝不离开 Worker、绝不落盘。所有重统计在 Worker 里由 core 算完，只有**聚合结果**随 `Friend[]` / `ReportData` 持久化。
- **合并模型**：`mergeFriends` 对统计字段是 `{ ...inc }`——取本次导入的新值整体替换，不做跨次累加（成立前提：微信每次按会话导出的是该好友完整历史）。真正的累加只发生在单次导入内的 `mergeConversations`。
  - **推论**：只要 `aggregate` 算出新字段，`mergeFriends` 的 `{ ...inc }` 自动带上它们，`merge.ts` 无需改动——与现有 `monthly` 完全一致。

## 三、数据模型

### 3.1 `Friend` 新增字段（core/`model/types.ts`，唯一真相源，持久化）

```ts
hourly:   number[]   // 长度 24，按小时(0–23)的消息数
weekHour: number[]   // 长度 168，索引 = getDay(0=周日)*24 + 小时（存储用 getDay，显示层重排为周一开头）
keywords: Array<{ word: string; count: number }>  // 该好友 Top 20 高频词，count 降序
```

- `createFriend`（core/`model/friend.ts`）初始化：`hourly: new Array(24).fill(0)`、`weekHour: new Array(168).fill(0)`、`keywords: []`。
- `ReportData.keywords` 字段已存在，本次真正填充（详见 §五全局派生）。

### 3.2 存储

- `Friend` 直接随现有 `saveFriends`/`hydrate` 流程落 IndexedDB；新字段是普通数组/普通对象，可结构化克隆，无需改 `storage.ts`（沿用现有 `toRaw` 处理）。
- 不新增独立的全局统计存储——全局图在渲染时由 `Friend[]` 派生（见 §五）。

## 四、core 计算

### 4.1 `aggregate`（core/`stats/aggregate.ts`）

在现有遍历 `msgs` 的循环中补充：

- `hourly[new Date(m.ts).getHours()]++`
- `weekHour[new Date(m.ts).getDay() * 24 + new Date(m.ts).getHours()]++`
- 文本词频：对 `m.text`（仅 `type === 'text'` 且非空）做分词累计，最终取 Top 20 写入 `keywords`。

### 4.2 中文分词（core 内，新建 `stats/segment.ts`）

- 用 `Intl.Segmenter('zh', { granularity: 'word' })`，只取 `seg.isWordLike` 的词段。
- **过滤规则**：
  - 去掉长度 < 2 的词；
  - 去掉纯数字 / 纯标点 / 纯 ASCII 符号；
  - 命中**内置中文停用词表**的丢弃（core 内常量数组，约 150–200 个：的/了/我/你/吗/啊/就/这/那/和/在 等）。
- 导出纯函数：
  - `tokenize(text: string): string[]` —— 分词 + 过滤；
  - `countWords(texts: Iterable<string>, topN: number): Array<{word,count}>` —— 累计并取 TopN。
- **core 纯净度**：`Intl.Segmenter` 属 ECMAScript `Intl`（非 DOM）。在 core 加一个最小类型声明（如 `src/intl-segmenter.d.ts`，声明 `Intl.Segmenter`），不引第三方依赖。

### 4.3 全局派生纯函数（core/`stats/aggregate.ts` 或新建 `stats/global.ts`）

不单独存全局数组，提供对 `Friend[]` 求和的纯函数：

```ts
sumHourly(friends: Friend[]): number[]            // 长度 24，逐位相加
sumWeekHour(friends: Friend[]): number[]          // 长度 168，逐位相加
mergeKeywords(friends: Friend[], topN: number): Array<{word,count}>  // 合并 count、重排、取 TopN
```

- **好处**：全局图永远基于"已累积的全部好友"，顺带修掉"全局报告只反映最后一次导入"的既有隐患；零重复存储。
- `hourly`/`weekHour` 为精确求和；`keywords` 因每人只存 Top20 会丢长尾，对海报可接受。

### 4.4 `buildReport`（core/`stats/report.ts`）

- `keywords` 由 `mergeKeywords(friends, N)` 填充（N 取 50 左右，全局用）。
- `buildReport` 已接收 `friends` 参数，直接复用，无需改 Worker 协议。

## 五、全局图数据来源

- **真相源**：持久化的 `Friend[]`。
- 全局页（`ReportPage`）渲染时对 `data.friends` 调 `sumHourly`/`sumWeekHour`/`mergeKeywords` 得到全局数组（或读 `report.keywords`）。
- 这样跨次导入也始终反映全部好友，不依赖某一次 run 的 `Conversation[]`。

## 六、UI

### 6.1 复用图表组件（`packages/web/src/components/charts/`）

手写 SVG/CSS，**零图表库依赖**，全部无状态、入参即数据数组：

- `HourBars.vue` —— 入参 `hourly: number[24]`，24 根 CSS 柱状条。
- `WeekHourHeatmap.vue` —— 入参 `weekHour: number[168]`，168 格 CSS grid；**显示重排为周一开头**（存储 `getDay` 0=周日 → 显示顺序 周一…周日），按值映射主题色阶深浅。
- `WordRanks.vue` —— 入参 `keywords: Array<{word,count}>`，排行榜式"词 + 条形 + 次数"列表（不做词云，YAGNI）。

### 6.2 全局：`ReportPage.vue`

- 海报内新增"时段柱状图 + 周×时热力图"两张图，数据来自对 `data.friends` 的 `sumHourly`/`sumWeekHour` 派生。
- **全局词频复用海报既有的"年度关键词"区块**（它已渲染 `report.keywords`，`buildReport` 填充后自动有内容），不重复加 WordRanks。`WordRanks` 组件仅用于单好友详情页。

### 6.3 单好友：独立详情页路由

- 新增路由 `{ path: '/friends/:id', name: 'friend-detail', component: FriendDetail }`（`router/index.ts`）。
- 新建 `pages/FriendDetail.vue`：按 `route.params.id` 从 `useDataStore().friends` 取该好友，展示其 `hourly`/`weekHour`/`keywords` 三图 + 基本信息；好友不存在时给空态。
- **`FriendsPage.vue` 已有的"点击行打开详情抽屉"保持不变**（抽屉继续承载全年分布/AI 分析/AI 建议/编辑）。在抽屉内新增一个"查看完整图表"入口（`RouterLink`），跳转到 `/friends/:id`。新页只承载三张新图，不重复抽屉里的编辑/AI 功能。

## 七、测试

### core（vitest）

- `tokenize`：给定中文文本，断言分词结果、停用词/短词/标点被过滤。
- `countWords` / `mergeKeywords`：累计与 TopN 截断正确。
- `aggregate`：构造带不同 `ts` 的消息，断言 `hourly`/`weekHour` 落在正确桶位、`keywords` 正确。
- `sumHourly`/`sumWeekHour`：多好友逐位求和正确。
- **环境注意**：确认 vitest 运行的 Node 版本支持 `Intl.Segmenter`（Node 16+ 具备）；若 CI/jsdom 不可用则在 setup 中 polyfill 或跳过纯分词端到端用例。

### web（vitest + @vue/test-utils）

- `HourBars`/`WeekHourHeatmap`/`WordRanks`：给定数组断言渲染（柱数/格数/重排顺序/列表项）。
- `FriendDetail`：按 id 取数渲染三图；未知 id 空态。
- `FriendsPage`：行点击导航到 `/friends/:id`。

## 八、明确不做（YAGNI）

- 不引任何图表库 / 词云库 / 第三方分词库。
- 不为全局新增独立持久化存储（一律由 `Friend[]` 派生）。
- 不改 `mergeFriends`/`storage.ts` 的核心逻辑（新字段随现有路径自然流转）。
- 不修「全局报告依赖单次 run 的 `Conversation[]`」之外的既有问题（本次仅就三新字段做派生式修正）。
