# 开机全自动 AI 分析队列设计

> 日期：2026-07-15
> 状态：已与用户确认，待评审 → 转 writing-plans

## 目标

打开小程序时，把「还没被 AI 分析过」的好友级功能**在后台自动分析完**，用户进入即可直接看到结果；全程**不卡 UI**、**不重复分析**；已分析过的功能**不再显示任何分析按钮**。开始阶段（未分析时）保留分析按钮，让用户能手动点、把想优先看的排到前面。

## 范围

### 纳入自动分析（好友级，真·全部好友、无消息数门槛）

| 功能 | aiClient 调用 | 「已分析」判定（现成读函数） | 落盘 |
|---|---|---|---|
| 关系/职务 | `suggestFriend` | `loadAnalyzedIds()` 含该 id | `updateFriend` + `saveAnalyzedIds` |
| 情绪分析 | `analyzeFriendSentiment` | `loadFriendSentiment(id,f)` !== null | `saveFriendSentiment` |
| 好友画像 | `analyzeFriendProfile` | `loadFriendProfile(id,f)` !== null | `saveFriendProfile` |
| MBTI | `analyzeFriendMbti` | `loadFriendMbti(id,f)` !== null | `saveFriendMbti` |
| 深度关系 | `analyzeRelationDeep` | `loadRelationDeep(id,f)` !== null | `saveRelationDeep` |

### 保留手动、本次不动

- **年度文案 / 全年情绪**（报告页）：`report.vue` 整个不改，维持现状。
- **命理运势**：需先填「我的生辰」+「好友生辰」，无法纯自动，保留手动。
- **股票提取**：需原始聊天全文（`Conversation[]`），全文按隐私约定从不落盘、只能在重新导入文件的当下抽取，保留现有「导入时抽取」流程。

## 架构：方案 A —— 单例 `aiQueue` store

新建 `packages/miniapp/src/stores/aiQueue.ts`，作为小程序里**所有 AI 分析（自动 + 手动）的唯一入口与唯一执行者**。这是满足「全局并发上限 + 手动插队 + 不重复 + 可断点续跑 + 可统一节流防卡」的前提——只有单一 owner 才能全局地数「正在跑几个、谁在跑」并统一节流。

### 数据结构

- `concurrency = 2`（常量；并发上限，为防上游 GACCODE 代理限流/超时，与卡顿无关）。
- `queue: 任务[]`（待跑，队首优先）。
- `running: Set<taskKey>`（正在跑的任务）。
- `taskKey = \`${feature}:${targetId}\``，如 `mbti:友aaa`、`sentiment:友bbb`——天然去重。
- 每任务对外暴露状态：`未分析 idle | 排队中 queued | 分析中 running | 已完成 done`。

### 任务登记表 registry

队列引擎不认识具体功能，只调 4 个纯函数。每个 feature 登记一条：

```
{
  isDone(ctx)   // 查缓存命中 → 判断是否已分析（非 null 即已完成，含过期）
  gather(ctx)   // 取输入：friend + samples（samples.loadSamplesFor(id)）
  run(input)    // 调对应 aiClient.xxx，返回结果
  persist(res)  // 落盘；空结果/失败不落盘（保持可重试）
}
```

引擎逻辑（并发、去重、插队、节流）写一遍、测一遍；加新功能只需加一行登记。这些纯函数便于单测。

### 引擎方法

- `scan()`：遍历 `好友 × 5 个好友级功能`，对 `!isDone` 且不在 `queue`/`running` 的入队。**按功能整表批量读缓存**（见「防卡①」），不是每好友每功能各读一次。开机 hydrate 后、每次导入成功后各调一次（幂等）。
- `pump()`：只要 `running.size < concurrency` 且 `queue` 非空，取队首起跑；`run` 完成后 `running.delete` 再 `pump()`。
- `prioritize(feature, id)`：把该任务移到队首；不在队列则新建入队并 `pump()`；**已在 `running` 则忽略（no-op）**。手动点按钮即调它。
- `stateFor(feature, id)`：给页面读的状态（`idle/queued/running/done`）。

### 状态机（每个 `feature:id`）

```
idle ──入队──> queued ──起跑──> running ──成功&落盘──> done（终态，冻结）
                                    └──空结果/失败──> idle（本会话不自动重试，下次开机或手动再来）
```

## 去重：不会重复分析

「已分析」的唯一标准 = **结果缓存非 null**（上表的 `loadXxx`）。三道防线，任意一道即可挡住重复：

1. **持久层（跨会话）**：缓存落盘后 `isDone` 恒真 → 永不再入队。空结果/失败不落盘 → 仍判「未分析」，下次重试，不会把一次失败当成「已分析」永久跳过。
2. **队列层（会话内）**：`taskKey = feature:id` 唯一，入队前检查不在 `queue`/`running`，同一任务不会在队里出现两次。
3. **运行层（手动 vs 自动）**：所有分析都经该队列。手动点 = `prioritize`，对已 `running` 的任务是 no-op；对在 `queue` 的只移位不新发。→ 「后台正跑某人 MBTI，用户同时手动点同一人 MBTI」最终只有一次调用。

**过期（stale）不触发重跑**：重新导入后 `loadXxx` 返回 `{ data, stale:true }`，仍非 null → `isDone` 真 → 自动队列跳过。已分析结果一旦生成即冻结。

## 按钮规则（好友级功能，逐个）

| 任务状态 | 按钮/UI |
|---|---|
| `idle`（未分析） | 显示【✦ 分析】按钮，可点 → `prioritize()` 插队 |
| `queued`（排队中） | 显示不可点的【排队中…】 |
| `running`（分析中） | 显示【分析中…】+ 进度条 |
| `done`（已完成，含过期） | **不渲染任何按钮/入口**，只显示结果 |

- 删除现有「分析完变成 ↻ 重新分析」的写法（`friend-detail.vue` 情绪/画像/MBTI 按钮、深度关系入口）。
- 删除已分析后的可点「数据已更新，点刷新」stale 入口（情绪/画像/MBTI 处）；过期只静态显示旧结果。
- **代价（用户已确认取舍）**：单个功能一旦分析过即无法单独重跑，要重算只能清数据重新导入。

## 防卡：卡顿源在同步写盘，不在并发

AI 网络调用（`wx.cloud.callFunction`/`wx.request`）异步、不占 JS 线程，故并发数与卡顿无关。真实卡顿源与对策：

1. **scan 的批量同步读**：天真实现 = `好友×功能` 逐个 `getStorageSync`（150×5=750 次同步读，卡在开机）。→ **按功能整表读一次**：复用/补齐 `loadFriendMbtiMap()` 式的整表读（一次 `getStorageSync` 拿整张 map，内存判成员），5 个功能共 5 次同步读。
2. **每结果整表同步写**：`saveFriendEntry` 每次把整张 `{[id]:...}` 大表 `setStorageSync`（`storage.ts` 已有 `[perf]` 插桩）。→ **结果先进内存缓冲 + debounce(≈800ms) 合并落盘**；App 退后台 / 队列排空时 flush。把「每结果一写」压成「每批一写」。结果不丢（flush 保证），同步写次数降一两个数量级。
3. **role 走 `updateFriend` 深拷贝整数组**：`updateFriend` 每次 `JSON.parse(JSON.stringify(friends))` 深拷贝全部好友（含 `hourly[24]`+`weekHour[168]`）再写文件（已有 `[perf]` 插桩）。→ 自动 role 的写入走**合并批量**，不逐个 `updateFriend` 立即落盘，与 ② 一起 debounce。
4. **渲染层 setData 泛滥**：→ 按钮态用**按 id 的细粒度 computed**，只让当前打开页里可见的任务驱动 UI；全局仅保留一个轻量「分析中」红点（复用 `useRelationDeepBadge` 模式）。不触碰大 `friends` 数组的响应式。

## 触发时机

- `main.ts`：`useDataStore().hydrate()` 之后调 `aiQueue.scan()`（不 await，后台跑）。
- `import.run` 成功后调 `aiQueue.scan()`（只把新好友缺口入队，幂等）。
- 跨会话：缓存即进度，下次开机 `scan` 自动跳过已完成、从未跑完处续跑。

## 现有代码归并

- **新增**：`stores/aiQueue.ts`（引擎 + 登记表）及其测试；storage 补齐各功能的整表读（如 `loadFriendSentimentMap`/`loadFriendProfileMap`/`loadRelationDeepMap`），并加内存缓冲 + debounce flush 层。
- **退休**：`stores/relationDeep.ts`（现「离开页面继续跑」单任务）→ 深度关系并入登记表；`relation-deep.vue` 改读 `aiQueue`；`composables/useRelationDeepBadge.ts` 改为监听 `aiQueue.busy`。
- **归并**：`import.ts` 的 `analyzePendingRoles`（开机自动 role、msg≥20 门槛、`analyzedIds` 去重）→ 并入登记表 `role` 任务，**去掉 msg≥20 门槛**（真·全部好友）；`analyzeOne`（好友列表手动 role）→ 改为 `prioritize('role', id)`。
- **页面改造**（「直接调 aiClient」→「读队列 + 下单」）：
  - `friend-detail.vue`：情绪/画像/MBTI/深度关系四处 → 读 `stateFor` 决定按钮渲染、点击 `prioritize`；结果照旧从 storage 读。
  - `friends.vue`：列表 role「AI 分析」按钮 → `prioritize('role', id)`，按状态渲染。
- **不动**：`report.vue`（年度文案/全年情绪）、命理、股票、`aiClient`、`@nianlun/core`、各 `storage.saveXxx` 签名（仅在其上加缓冲层）。

## 边界与错误处理

- **空结果/失败**：不落盘、任务回 `idle`、本会话不自动重试（避免死循环烧调用），下次开机或手动重试。沿用现有各 `analyzeXxx` 的空判定（如 profile 五侧面全空、mbti 为 null）。
- **深度关系**：内部仍是 3 段串行（撞 60s 硬顶的既有约束），作为「一个任务」占一个并发位，整体成功/部分成功后落盘；沿用现有容错（某段失败跳过、保留其它段）。
- **导入进行中**：`import` 与 `aiQueue` 各自独立；导入成功后才 `scan`，不与导入抢主线程写盘（debounce 天然错峰）。
- **无数据**：`friends` 为空时 `scan` 直接返回，不置任何忙态。

## 测试策略（Vitest）

- **引擎（纯逻辑，注入 fake registry/timer）**：并发上限（同时最多 2 running）、去重（同 key 不双入队/双跑）、`prioritize` 移队首且对 running 为 no-op、`isDone` 命中即跳过、空结果不落盘可重试、scan 幂等。
- **登记表各条**：`isDone/gather/run/persist` 对齐现有 storage 读写（注入内存 storage）。
- **防卡**：断言 scan 每功能只调一次整表读；断言 debounce 内多次 persist 只触发一次落盘 flush。
- **页面**（`@vue/test-utils`）：按 `stateFor` 渲染四种按钮态；点击调 `prioritize`；`done` 时无按钮、无 stale 刷新入口。

## 验收

实现后按 `verify` 在微信开发者工具 / 真机实跑：开机后台自动分析、进入页面即见结果、已完成无按钮、手动点插队生效、全程不卡、重复触发不重复调用。真机为最终裁判（参见既有「真机专属坑」记忆）。
