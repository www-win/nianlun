# 年轮 AI 好友分析 集成设计（第一期）

**Goal:** 给「年轮」的好友详情抽屉加一个「✨ AI 分析」功能：根据**单个好友的现有统计数据**，调用已接入的 AI 服务（gaccode / Anthropic 兼容 Messages API）生成一段中文关系画像，临时显示在抽屉里。本质是把已完成的「AI 报告文案」功能平移到单个好友身上。

**关联文档：** 复用 [AI 报告文案集成设计](2026-06-26-nianlun-ai-report-copy-design.md) 建立的全部基础设施（aiClient、settings store、UI 三态模式、隐私边界）。本设计只新增一个 core 纯函数和一个 web 组件。

---

## 1. 决定性前提：AI 只看聚合统计，看不到聊天原文

项目隐私铁律：原始聊天记录绝不离开 Worker、绝不持久化。主线程和 IndexedDB 里只有聚合后的 `Friend[]` + `ReportData`。因此本功能喂给 AI 的，**仅限单个 `Friend` 的统计字段**：

| 字段 | 含义 |
|---|---|
| `name` / `alias` | 昵称 / 备注 |
| `rel` | 关系（家人/挚友/同事/同学/客户/其他） |
| `role` | 用户补充的职务/标签 |
| `firstContact` / `lastContact` | 首次 / 最近联系时间（毫秒时间戳） |
| `msgCount` | 全年消息总数 |
| `sentRatio` | 我方发送占比（0–100） |
| `peakPeriod` | 活跃时段 |
| `maxStreak` | 最长连续聊天天数 |
| `monthly` | 长度 12 的月度消息分布 |

AI 做的是「看数据下判断」（关系亲疏、互动节奏、值得记住的点），**不是**「读你们聊了啥」。

## 2. 架构

无后端，遵循项目铁律 `web → core`、`core` 不碰网络/DOM：

- **core（纯函数）**：新增 `buildFriendAnalysisPrompt(friend: Friend): string`，与现有 `buildReportCopyPrompt` 并排放在 `packages/core/src/ai/prompts.ts`，从 `@nianlun/core` 导出。
- **web（适配器 + UI）**：
  - **复用** `adapters/aiClient.ts` 的 `generateText` —— 网络请求、401/429/网络/空内容容错一行不改。
  - **复用** `stores/settings.ts` 的 apikey 配置 —— 报告页填过的 key 在好友页直接生效，无需重填。
  - **抽取共享组件** `components/AiPanel.vue`（DRY 决策，见下）—— 把现有 `AiCopyPanel.vue` 的「AI 设置折叠区 + 生成按钮 + loading/错误/结果三态 + 隐私提示」逻辑抽成一个通用组件，接收一个 `buildPrompt: () => string` 闭包与按钮文案。报告页与好友页都复用它，不再各写一份。
  - **接入** `pages/FriendsPage.vue` 的详情抽屉，传入 `() => buildFriendAnalysisPrompt(drawerFriend)`。

> **DRY 决策（与初版设计的差异）**：初版设计打算新建一个与 `AiCopyPanel` 对称的 `AiFriendPanel.vue`，但二者会逐行重复「设置 + 生成 + 三态 + 隐私提示」逻辑。经确认改为**抽取共享 `AiPanel.vue`**：报告页与好友页只是传入不同的 `buildPrompt` 闭包和按钮文案。`AiCopyPanel.vue` 及其测试随之被 `AiPanel.vue` 取代。

## 3. 组件契约

### 3.1 core：`buildFriendAnalysisPrompt(friend: Friend): string`

- 输入：单个 `Friend`。
- 输出：一段中文提示词字符串，要求 AI 输出 100~200 字、口语化、有温度的中文关系画像；把数字自然融进叙述，不罗列清单；只输出画像本身，不要标题/解释。
- 显示名优先级：`alias || name`（与 `buildReportCopyPrompt` 一致）。
- 纯函数，无副作用，不碰时间/网络/DOM。时间戳按需在提示词里说明其为「首次/最近联系」即可，不强制格式化为日期（保持纯函数，避免本地化依赖）。

### 3.2 web：共享组件 `AiPanel.vue`

- Props：`{ buildPrompt: () => string; buttonLabel: string; busyLabel: string }`。
- 行为：点击按钮 → `buildPrompt()` 取得提示词 → `generateText(prompt, settings)` → 结果填入 `result`。
- 状态：`loading` / `error` / `result` 三态。
- 配置：内置「AI 设置」折叠区（接入地址 / API Key / 模型 + 保存），读写 `useSettingsStore`；`isConfigured` 未配置时按钮禁用。报告页配置过的 key 在好友页直接生效。
- 隐私提示（逐字）：`使用 AI 功能时，相关统计数据会发送至 AI 服务进行处理。`
- 报告页用法：`buildPrompt = () => buildReportCopyPrompt(report, friends)`，`buttonLabel = '✨ AI 生成文案'`。
- 好友页用法：`buildPrompt = () => buildFriendAnalysisPrompt(friend)`，`buttonLabel = '✨ AI 分析'`。

### 3.3 接入点：`FriendsPage.vue` 抽屉

- 在抽屉 `.drawer-body` 内（如「编辑信息」区附近）插入 `<AiPanel>`，传入好友的 `buildPrompt` 闭包、`buttonLabel="✨ AI 分析"`，并用 `:key="drawerFriend.id"` 在切换好友时重建组件以清空上一位的结果。仅在 `drawerFriend` 非空时渲染。
- 抽屉关闭 / 切换好友即丢弃结果——**结果临时显示，不持久化**。

## 4. 数据流

```
用户点某行 → openDrawer(friend) → 抽屉显示该 friend
  → 点「✨ AI 分析」
  → buildFriendAnalysisPrompt(friend)   [core, 纯函数]
  → generateText(prompt, settings)       [web, 复用 aiClient]
  → 显示结果 / 错误                        [web, 临时, 不入库]
```

不触碰 IndexedDB，不调用 `updateFriend`，不改任何持久化结构。

## 5. 错误处理

完全继承 `generateText` 已有的错误语义并显示在面板里：

- 网络/CORS 失败 → 「无法连接 AI 服务…（也可能是跨域 CORS 限制）」
- 401 → 「API Key 无效…」
- 429 → 「调用太频繁或额度已用尽…」
- 其他非 2xx → 「AI 服务返回错误（HTTP xxx）」
- 空内容 → 「AI 返回内容为空」

面板用红色提示（`role="alert"`）展示，不崩页。

## 6. 测试

- **core**：`buildFriendAnalysisPrompt` 单测 —— 断言提示词包含关键字段（昵称、关系、消息数等），并验证 `alias` 优先于 `name`。
- **web**：`AiPanel` 组件测试（mock `generateText`）—— 未配置时按钮禁用、显示隐私提示与按钮文案、配置后点击调用 `buildPrompt` 与 `generateText` 并显示结果。取代原 `AiCopyPanel` 测试。
- 全量 `pnpm --filter @nianlun/web exec vitest run` 与 `pnpm --filter @nianlun/core exec vitest run` 通过；`pnpm --filter @nianlun/web build`（vue-tsc + vite）无类型错误。

## 7. 范围之外（本期不做）

- ❌ AI 写回关系标签 / 职务（`updateFriend`）—— 留待后续。
- ❌ 整张好友表批量分析 / 并发请求 / 进度与额度管理 —— 留待后续。
- ❌ 分析结果持久化（IndexedDB）—— 本期只临时显示。
- ❌ 把聊天原文喂给 AI —— 违反隐私铁律，永不做。
- ❌ streaming 流式输出。

## 8. 与第一期报告文案的关系

| 维度 | 报告文案（已完成） | 好友分析（本设计） |
|---|---|---|
| core 纯函数 | `buildReportCopyPrompt(report, friends)` | `buildFriendAnalysisPrompt(friend)` |
| web 组件 | 共享 `AiPanel.vue`（由 `AiCopyPanel` 抽取而来） | 复用同一个 `AiPanel.vue` |
| 网络 | `aiClient.generateText` | 复用 |
| 配置 | `settings` store | 复用 |
| 接入页 | `ReportPage.vue` | `FriendsPage.vue` 抽屉 |
| 持久化 | 无 | 无 |

新增面极小：1 个 core 函数 + 把现有面板抽成 1 个共享组件 + 1 处接入，网络/配置全部复用。
