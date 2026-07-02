# 自动分析改造：后台非阻塞 + 消息门槛 + 启动补跑 设计

> **状态：** 已通过 brainstorming 评审，待写实现计划。
> **分支：** fix/role-analysis-surface-failures（已含诊断提交 0fbc19b：analyzeRolesForNew 回传 succeeded/failed/empty/firstError、导入页现形失败）。
> **背景：** 上一版「导入后自动批量分析关系/职务」在上千好友量级下暴露三问题：①阻塞导入（串行逐个云调用，导入页长时间卡在「正在分析」）；②对全部上千位无脑分析，成本/限流/噪声都不可接受；③只在导入时触发，存量（已导入、从未分析）的好友永不分析。目标用户是金融从业者、微信联系人上千。

## 1. 目标

把自动分析改成**后台非阻塞**、**只分析有价值的好友（消息数达标）**、**导入后与每次启动都补跑未分析的**。导入秒显完成、上千好友立即可用，关系/职务在后台渐进补上。

## 2. 全局约束

- 注释/文案用**中文**。
- `@nianlun/core` 纯函数库不改；复用 `aiClient.suggestFriend`。严格 miniapp → core 单向依赖。
- 只用有界样本（`loadSamplesFor`），不落聊天原文。
- **串行**调用（不并发），避免打爆微信云函数/触发限流；后台化已消除「慢」的体验痛点。
- 增量：只分析「不在 `analyzedIds` 且消息数达标」的好友；失败/无结果不计入集合、下次触发重试。
- mp-weixin 模板不用可选链 `?.`。
- **Windows 上用 PowerShell 跑 build/test**。

## 3. 关键决策（已与用户确认）

- **消息门槛**：只分析**全年消息 ≥ 20 条**的好友。常量 `ROLE_MIN_MSGS = 20`（集中定义、易改）。
- **非阻塞**：导入流程先 `setData` + 存样本 + 置 `status='done'`，**之后**才跑分析；分析期间导入页显示「✅ 已导入」+ 独立的「正在分析 x/M」横幅。
- **触发点**：①导入完成后；②**App 启动 hydrate 之后**（补跑存量里未分析、达标的好友）。
- **串行、不并发**。

## 4. 架构与组件

### 4.1 抽出共用 store action：`analyzePendingRoles`
在 import store 里新增一个 action，供「导入后」与「App 启动」两处共用：
```ts
async function analyzePendingRoles(): Promise<void>
```
行为：
1. **重入保护**：`if (analyzing.value) return`（已有分析在跑则跳过）。
2. 从 `useData().friends` 取候选：`f.msgCount >= ROLE_MIN_MSGS` 且 `id ∉ storage.loadAnalyzedIds()`。**候选为空则直接 return**（不置 analyzing）。
3. **立即置位守卫**：`analyzing.value = { done: 0, total: 候选.length }`（在任何 await 之前，确保并发的第二次调用能被步骤 1 的 guard 挡住——不依赖 `analyzeRolesForNew` 的内部时序）。
4. 调 `analyzeRolesForNew({ friends: 候选, analyzedIds, loadSamples, suggest, applyRole: data.updateFriend, onProgress → analyzing })`（串行，沿用诊断版返回统计）。
5. `storage.saveAnalyzedIds(result.analyzedIds)`；`analyzing.value = null`；把 `analysisWarn(result)` 追加进 `warnings`。
6. 整体 `try/finally`：`finally` 里 `analyzing.value = null`（异常也归零，不影响已完成的导入/启动）。

> 门槛过滤放在 `analyzePendingRoles` 里（候选构造阶段），保持 `analyzeRolesForNew` 通用、不掺业务门槛。

### 4.2 import store `run()`：解耦「完成」与「分析」
`if (chatFiles.length)` 分支改为：`setData` → 存样本 → 存 recentInsights/Samples → 设 parse/联系人 warnings → **`status='done'`** → `await analyzePendingRoles()`。
- `status='done'` 在分析之前置位：导入页立即显示完成、`data.friends` 已就绪、好友页可用。
- `run()` 内部仍 `await` 分析到结束（测试可确定性等待），但 UI 早已解锁 → 体验为「秒完成、后台补」。
- 其余分支（仅 contacts、无解析结果）不触发分析；末尾 `status='done'` 逻辑保持。

### 4.3 App 启动触发
`App.vue` 的 `onLaunch` 改为：cloud.init → `await useDataStore().hydrate()` → `useImportStore().analyzePendingRoles()`（**不 await**，后台跑，不阻塞启动）。hydrate 后 `data.friends` 已加载，`analyzePendingRoles` 挑存量里达标未分析的补跑；重入保护避免与后续导入并发。

### 4.4 导入页 UI（import.vue）
把「正在分析 x/M」横幅从 `status==='parsing'` 块里移出，改为**独立块** `v-if="imp.analyzing"`（不依赖 status），这样 `status='done'`（已导入）时横幅仍显示：
```html
<view v-if="imp.analyzing" class="status">
  <text class="status-t muted">正在分析关系/职务… {{ imp.analyzing.done }}/{{ imp.analyzing.total }}</text>
</view>
```
`status==='parsing'` 块恢复为纯「解析中 pct%」（不再内嵌 analyzing 分支）。分析完横幅消失、warnings 追加统计行。（`imp.analyzing.done` 在 `v-if="imp.analyzing"` 保护下，无 `?.`。）

## 5. 数据流

导入：`parseLocal → setData(friends 立即可用) → 存样本 → status=done → analyzePendingRoles(后台补 rel/role)`
启动：`hydrate(载入存量 friends) → analyzePendingRoles(后台补存量中达标未分析的)`
两处共用同一 action、同一 `analyzedIds` 去重、同一门槛。

## 6. 错误处理

- 单个好友失败/无结果：`analyzeRolesForNew` 已计入 failed/empty、不进集合、下次重试（诊断版逻辑，保留）。
- 后端整体不可用：全部失败，`warnings` 显示「M 位失败：<firstError>」，导入/启动本身不受影响。
- 重入保护避免并发重复分析。

## 7. 测试

- `analyzeRolesForNew`：沿用现有 5 + 诊断统计断言（不改）。
- import store：
  - `analyzePendingRoles` 只分析 `msgCount>=20 且不在集合` 的好友；<20 的不调用 suggest、不进集合（注入 mock suggest + 门槛好友夹具）。
  - 导入后 `status==='done'` 且达标好友被写入 rel/role、进集合。
  - 重入保护：`analyzing` 非 null 时再调用直接返回、不重复分析。
  - 失败现形（保留上一版用例）。
- `App.vue` onLaunch 无单测（时序/运行时），靠 `build:mp-weixin` + 人工验证。
- import.vue 横幅挪位无单测，靠 build 验证。

## 8. 边界与说明

- **门槛可改**：`ROLE_MIN_MSGS=20`。将来某人消息涨过 20，再次导入/启动会纳入分析。
- **非阻塞的可测性**：UI 早解锁是时序属性，单测断言 `status==='done'` + 结果已应用即可，不强测时序。
- **启动补跑的量**：门槛 + 集合去重把每次启动的调用限制在「存量里达标、且尚未分析」的一次性补齐；跑过即入集合，不重复。
- **并发触发**：重入保护下，同一时刻只有一批在跑；若启动分析进行中用户又导入，新好友会在下次启动补上（可接受的小间隙）。
- **不改 core、不加并发**（YAGNI；后台化已解决慢）。
