# 四类 AI 分析结果持久化 设计

> **状态：** 已通过 brainstorming 评审，待写实现计划。
> **依赖链：** 严格 `miniapp → core`。本功能**不改 core**，只在 miniapp 存储层与页面加缓存读写。
> **来源：** 用户诉求「所有 AI 分析结果都需要持久化保存」。排查发现只有「关系/职务推断」已持久化，其余四类只落在组件 ref，页面离开或小程序重启即丢，反复消耗 AI 额度。

## 0. 背景与问题

小程序端共有 5 类 AI 分析（[aiClient.ts](../../../packages/miniapp/src/adapters/aiClient.ts)），持久化现状：

| AI 分析 | 调用处 | 现状 |
|---|---|---|
| 关系/职务推断 `suggestFriend` | 导入编排 `stores/import.ts` | ✅ 已持久化（写入 `Friend` + `analyzedIds`） |
| 报告文案 `generateReportCopy` | `report.vue` `copy` ref | ❌ 未存 |
| 全年情绪 `analyzeYearSentiment` | `report.vue` `mood` ref | ❌ 未存 |
| 好友情绪 `analyzeFriendSentiment` | `friend-detail.vue` `sentiment` ref | ❌ 未存 |
| 好友画像 `analyzeFriendProfile` | `friend-detail.vue` `profile` ref | ❌ 未存 |

后四类只在组件内存 ref 中，页面切走/小程序重启即丢，每次查看都要重新调云函数，反复烧 token。

> **与旧决策的关系**：命理运势 spec（[2026-07-06-friend-astrology-fortune-design.md](2026-07-06-friend-astrology-fortune-design.md) §3、§8.3）当初把「情绪 tone/summary、好友画像」列为**有意不持久化**。本 spec 推翻该决策，把这四类也纳入持久化，并**复用命理运势已确立的「持久化 + 时效指纹」范式**，保持全局一致。

## 1. 目标

把「报告文案、全年情绪、好友情绪、好友画像」四类 AI 结果持久化到小程序本地存储，进页面命中缓存即直接展示、免重复调用 AI；数据变化时以**软提示**告知可能过时，由用户手动刷新，不自动清空、不自动重算。

## 2. 全局约束

- 注释/文案用**中文**。
- **不改 `@nianlun/core`**：这四类的 prompt 构造与容错解析（`buildReportCopyPrompt` / `buildYearSentimentPrompt` / `buildFriendSentimentPrompt`+`parseSentiment` / `buildFriendProfilePrompt`+`parseFriendProfile`）已存在且不变。本功能纯属 miniapp 适配层 + 页面改动，**零 core 回归**。
- 小程序端持久化用 `wx.getStorageSync` 键值存储（**非 IndexedDB**——那是 web 时代措辞），沿用 `nianlun:` 键前缀，代码风格对齐 [storage.ts](../../../packages/miniapp/src/adapters/storage.ts) / [samples.ts](../../../packages/miniapp/src/adapters/samples.ts)。
- 触发方式**不变**：首次仍由用户手动点「生成/分析」；持久化只影响「第二次及以后」——命中缓存直接渲染。
- 不落盘聊天原文：缓存的是 AI 生成的结构化结果（文案/情绪/画像），不含原始聊天。指纹只用聚合统计数字，也不含原文。
- **Windows 上用 PowerShell 跑 build/test**。

## 3. 架构（沿用命理运势 §8.3 范式）

时效判定逻辑放**存储适配层**（与 astrology 一致），页面只消费「缓存 + 是否过期」两态。

- **[storage.ts](../../../packages/miniapp/src/adapters/storage.ts)**：新增四组 `save*` / `load*`，`load*` 统一返回 `{ data, stale } | null`。四个新键并入 `clearAll()`。
- **页面**：`friend-detail.vue`、`report.vue` 进页面读缓存、渲染三态；分析成功后写盘。
- 不改导入流程、不改现有 prompt/parse、不改 `Friend` 类型。

### 存储键

| 键 | 层级 | 值结构 |
|---|---|---|
| `nianlun:reportCopy` | 报告级·单条 | `{ text: string; fp: string }` |
| `nianlun:yearMood` | 报告级·单条 | `{ text: string; fp: string }` |
| `nianlun:friendSentiment` | 好友级·map | `{ [id: string]: { data: Sentiment; fp: string } }` |
| `nianlun:friendProfile` | 好友级·map | `{ [id: string]: { data: FriendProfile; fp: string } }` |

- 好友级用 map（类比 `recentInsights`），报告级用单键（类比 `report`）。
- `Sentiment`（`{ tone?; summary? }`）与 `FriendProfile` 均为 core 已导出类型，直接复用，**绝不重定义**。

## 4. 指纹与时效判定

**指纹（fp）= 生成时喂给 AI 的输入的轻量指纹**；输入不变则缓存新鲜。分层选取以避免误报过期：

- **好友级**（情绪 / 画像）：`fp = \`${friend.msgCount}:${friend.lastContact}\``（字段已核对 `core/model/types.ts`：`Friend.msgCount`、`Friend.lastContact` 均存在）。
  - 好友级分析的输入是该好友自身的统计 + 样本。故仅当**该好友**有新消息时才判过期；重新导入只影响别的好友时，本好友缓存仍新鲜、不打扰。这是 per-friend 指纹的价值。
- **报告级**（文案 / 全年情绪）：`fp = \`${report.totalMessages}:${report.friendCount}:${report.activeDays}\``（字段已核对：`ReportData` 三者均存在）。
  - 报告是全局聚合，任一有效导入都会变，缓存随之判过期——符合直觉。

**三态判定与处理**（完全对齐命理运势 §8.3）：

1. **无缓存**（`load* === null`）→ 维持现状：显示「生成/分析」按钮，点击才调 AI，成功后写盘。
2. **有缓存且 fp 一致**（`stale: false`）→ 进页面**直接渲染**，不调 AI。
3. **有缓存但 fp 不一致**（`stale: true`）→ **仍渲染旧结果**，加一行软提示「数据已更新，点击刷新」+「刷新」按钮；用户点击才重算并覆盖存储。**不自动清空、不自动重算**。

**读取接口形态**（示意）：

```typescript
// 好友级：传入当前 friend 以现算 fp 比对
loadFriendSentiment(id: string, friend: Friend): { data: Sentiment; stale: boolean } | null
loadFriendProfile(id: string, friend: Friend): { data: FriendProfile; stale: boolean } | null
// 报告级：传入当前 report 以现算 fp 比对
loadReportCopy(report: ReportData): { data: string; stale: boolean } | null
loadYearMood(report: ReportData): { data: string; stale: boolean } | null
// 写入：内部按当前 friend/report 现算 fp 一并存
saveFriendSentiment(id: string, friend: Friend, data: Sentiment): void
saveFriendProfile(id: string, friend: Friend, data: FriendProfile): void
saveReportCopy(report: ReportData, text: string): void
saveYearMood(report: ReportData, text: string): void
```

- 缺键/类型不符一律容错返回 `null`（`wx.getStorageSync` 对缺失键返回 `''`，需按类型兜底，沿用 storage.ts 现有做法），**永不抛异常**。

## 5. 页面改动

触发方式不变，首次手动、之后走缓存。

### 5.1 [friend-detail.vue](../../../packages/miniapp/src/pages/friend-detail/friend-detail.vue)（情绪卡 / 画像卡）

- `onLoad` 拿到 `id`、`friend` 后：`loadFriendSentiment(id, friend)` / `loadFriendProfile(id, friend)` 命中即填 `sentiment` / `profile` ref，并记录各自的 `stale` 标志。
- `analyzeSentiment` / `analyzeProfile` 成功后：`saveFriendSentiment(id, friend, r)` / `saveFriendProfile(id, friend, r)` 写盘。
- 按钮文案随状态变：无缓存「✦ 情绪分析」/「生成画像」→ 有缓存「↻ 重新分析」；`stale` 时对应卡顶显示「数据已更新，点击刷新」。
- **空结果不写盘**：AI 返回无有效内容（现有代码里的「AI 无法判断情绪」/「AI 无法生成画像」占位）时**不写缓存**，页面照常展示占位但不落盘，以便用户下次重试（语义对齐 `analyzeRolesForNew`：无有效结果不计入、可重试）。仅当拿到有效 `data` 才 `save*`。

### 5.2 [report.vue](../../../packages/miniapp/src/pages/report/report.vue)（文案 copy / 全年情绪 mood）

- `onMounted` 且 `report` 存在时：`loadReportCopy(report)` / `loadYearMood(report)` 命中即填 `copy` / `mood` ref；`copy` 命中时触发一次 `draw()` 使海报出图。
- `genCopy` / `genMood` 成功后写盘。
- `stale` 时在对应区块顶显示「数据已更新，点击刷新」提示（刷新即现有的 `genCopy`/`genMood` 按钮）。
- 全年情绪原有的「发送 N 条片段到 AI」确认弹窗保留；命中缓存直接展示时**不弹窗**（未发起新调用）。

## 6. 测试（TDD）

重点在可纯测的存储层；页面沿用小程序「无单测、手测」惯例。

**[storage.test.ts](../../../packages/miniapp/src/adapters/__tests__/storage.test.ts)（fake-indexeddb 环境已在用）：**

- **往返一致**：四类各自 `save` 后 `load` 读回 `data` 一致。
- **新鲜命中**：同一 `friend`/`report` 存后读 → `stale: false`。
- **过期判定**：改变 `friend.msgCount`（或 `report.totalMessages` 等）使 fp 变更后读 → 返回**旧缓存 data** + `stale: true`，且**未清空**存储。
- **无缓存**：未写过 → `load* === null`。
- **好友级 map 隔离**：写好友 A 不影响好友 B 的读取。
- **clearAll**：调用后四个新键 `load*` 皆返回 `null`。
- **容错**：键值被写成非法类型（如字符串）时 `load*` 返回 `null`、不抛异常。

> 空结果不写盘（§5.1）由页面逻辑保证（页面无单测）；实现时在页面分支中只对有效 `data` 调 `save*`。

**构建/手测：** 不改 core，无需重 build core；页面改动靠 `pnpm --filter @nianlun/miniapp build:mp-weixin` + 微信开发者工具手测四类的「首次生成 → 重进直接显示 → 改数据后显示过期提示 → 刷新覆盖」链路。

## 7. 已知边界 / 非目标

- **不做自动重算/自动清空**：过期只软提示，尊重用户手动刷新（省 token、不打扰）——与命理运势一致。
- **不引入日期时效**：这四类无「随天变化」维度（区别于命理流月流日），过期仅由数据指纹驱动。
- **空结果不写盘**（见 §5.1）：AI 无有效结果时不落盘，允许下次重试。
- 不改关系/职务推断（已持久化）、不改导入流程、不改 core。
