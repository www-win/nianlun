# 年轮 AI 建议关系/职务 集成设计（第二期·写回）

**Goal:** 在好友详情抽屉里加「✨ AI 建议关系/职务」：把该好友的**部分聊天内容样本 + 聚合统计**发给 AI，让它返回结构化的「关系 + 职务 + 理由」建议；用户点「采纳」后写回好友表（经 `updateFriend`，记 `userEdited`）。

**与前序功能的关系：** 这是「AI 好友画像」（第一期，只读、只发统计）的进阶。本期**放宽隐私边界**：为让 AI 真正能推断关系/职务，需要把聊天内容样本一并发送。两者在抽屉里并存但相互独立（隐私提示、产出、是否写回都不同）。

---

## 1. 决定性前提与本期的边界调整

第一期铁律是「聊天原文绝不离开 Worker、绝不持久化，AI 只拿聚合统计」。但纯数字统计**推不出职务、关系也只能瞎猜**。经与用户确认，本期做两点放宽，其余铁律不变：

1. **允许把聊天内容样本发送给 AI 服务**（用户知情授权；带明确的、比画像更强的隐私提示）。
2. **样本只留内存、不持久化**：导入时截取，存活于当前会话的 Pinia store；**绝不写入 IndexedDB**，刷新即失。IndexedDB 仍只存 `Friend[]` + `ReportData`。

不变的铁律：`web → core` 单向依赖；`core` 不碰 `window`/`document`/`fetch`/`IndexedDB`/`vue`/网络/DOM；`Relation` 从 core import 不重定义；API key 只在 localStorage；写回一律经 `updateFriend`（页面不直接改 store）。

## 2. 架构与数据流

```
导入（import store.run）
  → Worker 内 core：parse → aggregate → report（现有）
  → 额外：core 纯函数 extractFriendSamples(conversations) 截每个好友的消息样本
  → parseClient 把 samples 随 ParseOutcome 带回主线程
  → import store 用内存 Map<friendId, string[]> 保存 samples（不入库）

好友抽屉（FriendsPage）
  → 读 import store 里该 friend.id 的样本
  → 点「✨ AI 建议关系/职务」
  → buildFriendSuggestionPrompt(friend, samples)   [core 纯函数]
  → generateText(prompt, settings)                  [web，复用 aiClient]
  → parseFriendSuggestion(返回文本)                 [core 纯函数，容错]
  → 抽屉显示：建议关系 / 建议职务 / 理由
  → 用户点「采纳」→ data.updateFriend(id, { rel, role }) 写回
```

样本边界（在 `extractFriendSamples` 内完成，控制发送量）：每个好友最多取约 30 条 `type === 'text'` 的消息，每条文本截断到 80 字，按时间顺序均匀/靠后采样，双向（me/them）混合。

## 3. core 单元（三个纯函数 + 导出）

### 3.1 `extractFriendSamples(conversations: Conversation[], opts?): Record<string, string[]>`
- 键为会话 id（等于 `Friend.id`，因 `aggregate` 用 `createFriend(c.id, ...)`）。
- 仅取 `type === 'text'` 且 `text` 非空的消息；每条截断到 `opts.maxChars`（默认 80）；每个好友最多 `opts.maxPerFriend`（默认 30）条。
- 纯函数，无副作用。

### 3.2 `buildFriendSuggestionPrompt(friend: Friend, samples: string[]): string`
- 输入：单个好友 + 其消息样本。
- 输出：提示词，要求 AI **只输出严格 JSON**（不要解释、不要围栏外文字）：
  `{"rel": "<家人|挚友|同事|同学|客户|其他 其一>", "role": "<职务或身份标签，简短>", "reason": "<一句话依据>"}`
- 显示名优先级 `alias || name`；同时给出聚合统计与样本，标注样本为「部分聊天内容」。

### 3.3 `parseFriendSuggestion(text: string): { rel?: Relation; role?: string; reason?: string }`
- 容错：剥除 ```json / ``` 围栏与多余文字，定位首个 `{...}` 做 `JSON.parse`。
- 校验：`rel` 必须 ∈ `Relation` 的 6 个值，否则丢弃 `rel`；`role`/`reason` 取字符串、trim。
- **永不抛异常**：完全无法解析时返回 `{}`。

### 3.4 导出
从 `@nianlun/core` 导出上述三个函数（`extractFriendSamples`、`buildFriendSuggestionPrompt`、`parseFriendSuggestion`）。

## 4. web 单元

### 4.1 parse 管线带回样本
- `worker/parse.worker.ts`：已有 `conversations` 变量（聚合前）；额外调用 `extractFriendSamples(conversations)`，把 `samples` 放进 'done' 消息。
- `worker/protocol.ts`：`ParseResponse` 的 `'done'` 分支新增 `samples: Record<string, string[]>`。
- `adapters/parseClient.ts`：`ParseOutcome` 新增 `samples` 字段并透传。
- `ParseOutcome` 仍**不**携带完整 `Conversation[]`；只新增有界的 `samples`。

### 4.2 import store 保存样本（内存）
- `stores/import.ts` 的 `run()` 在写入数据后，把本次 `samples` 存进一个**非持久化**的 store 状态（如 `friendSamples: Ref<Record<string,string[]>>`）。
- 不经 `toRaw`/IndexedDB；刷新即空。提供读取方法（如 `samplesFor(id)`）。

### 4.3 `FriendSuggestPanel.vue`（新组件，独立于画像 AiPanel）
- Props：`{ friend: Friend; samples: string[] }`。
- 行为：点「✨ AI 建议关系/职务」→ `buildFriendSuggestionPrompt(friend, samples)` → `generateText` → `parseFriendSuggestion` → 展示建议（关系、职务、理由）+「采纳」按钮。
- 「采纳」：组件 `emit('apply', { rel?, role? })`（仅含能识别的字段）；由 `FriendsPage` 监听并调 `data.updateFriend(friend.id, payload)`（页面层写回，符合「编辑经 updateFriend」铁律）。组件自身不直接改 store。
- 三态：loading / error / 建议结果。
- **样本为空时**：按钮禁用 + 提示「请重新导入聊天记录后再分析（样本仅存于本次会话）」。

### 4.4 接入 FriendsPage 抽屉
- 在抽屉里、画像 `AiPanel` 附近，加一节「AI 建议关系/职务」，渲染 `FriendSuggestPanel`，传入 `drawerFriend` 与 `importStore.samplesFor(drawerFriend.id)`，并用 `:key="drawerFriend.id"` 切换好友时重建。
- 采纳后调用既有 `data.updateFriend`；抽屉内的关系下拉/职务输入框随 store 更新。

## 5. 隐私提示（逐字，强于画像那条）

> `AI 建议关系/职务需要把该好友的部分聊天内容发送至 AI 服务进行处理。聊天内容不会被保存，仅用于本次分析。`

## 6. 错误处理

- 无样本 → 按钮禁用 + 上述提示。
- AI 文本无法解析为 JSON / 解析后无任何可用字段 → 显示「AI 返回格式无法识别，请重试」。
- `rel` 非法 → 忽略该字段，仅用 `role`/`reason`。
- 网络 / 401 / 429 / 空内容 → 复用 `generateText` 既有错误语义。

## 7. 测试

- **core**：
  - `extractFriendSamples`：条数上限、单条截断、过滤非 text、键为 friend id。
  - `buildFriendSuggestionPrompt`：含好友名/关系/样本片段、含「JSON」「只输出」类指令、alias 优先。
  - `parseFriendSuggestion`：纯 JSON、带 ```json 围栏、前后有多余文字、非法 rel 被丢、垃圾输入返回 `{}` 不崩。
- **web**：
  - import store：`run` 后 `samplesFor(id)` 能取到样本且未写入 IndexedDB（IndexedDB 仍只有 Friend[]/ReportData）。
  - `FriendSuggestPanel`（mock `generateText`）：无样本禁用、显示强隐私提示、点击后展示建议、采纳触发写回回调。
- 全量 `core` / `web` vitest + `web` build（vue-tsc）通过。

## 8. 范围之外（本期不做）

- 整表批量建议（留待后续，可复用同套 core 逻辑）。
- 样本持久化到 IndexedDB。
- 中文分词 / 关键词抽取（直接发消息样本）。
- AI 写回 `alias`（只写 `rel`/`role`）。
- streaming。

## 9. 单元边界小结

| 单元 | 职责 | 依赖 |
|---|---|---|
| `extractFriendSamples` (core) | 会话 → 有界消息样本 | 纯函数 |
| `buildFriendSuggestionPrompt` (core) | 好友+样本 → 提示词(要求 JSON) | 纯函数 |
| `parseFriendSuggestion` (core) | AI 文本 → 结构化建议(容错) | 纯函数 |
| parse 管线 (web worker/parseClient) | 产出 ParseOutcome 时附带样本 | core, 不持久化原文 |
| import store (web) | 内存保存样本 | 不入 IndexedDB |
| `FriendSuggestPanel` (web) | 触发/展示建议/采纳 | generateText, settings, core |
| FriendsPage 抽屉 (web) | 接入面板 + 写回 updateFriend | import store, data store |
