# 导入后自动批量分析职务/关系（增量、记住已分析）设计

> **状态：** 已通过 brainstorming 评审，待写实现计划。
> **分支：** feat/auto-role-analysis（已含「AI 点击即触发」提交 dd3c02c）。

## 1. 目标

去掉好友页/详情页手动的「✦ 智能建议」按钮，改为：**每次导入聊天数据完成后，自动对「新导入、还没分析过」的好友逐个调用 AI 推断并直接写入「关系 + 职务」**。已分析的好友被记住，再次进入小程序或再次导入都不重复分析，只分析新的。

**动机**：目标用户是金融从业者，好友多，手动逐个点「智能建议」太繁琐；希望导入即自动补齐关系/职务标签。

## 2. 全局约束

- 注释/文案用**中文**。
- `@nianlun/core` 是纯函数库：不碰 DOM/window/网络/vue。批量编排逻辑放 **miniapp**，core 侧复用已有的 `buildFriendSuggestionPrompt`/`parseFriendSuggestion`（经 `aiClient.suggestFriend`）。
- 严格单向依赖 miniapp → core。
- 只用**有界样本**（`samples.loadSamplesFor`），不改「聊天原文不落盘」铁律。
- 逐个好友一次 AI 调用；**增量**：只分析未在「已分析集合」里的好友。
- mp-weixin 模板不用可选链 `?.`，用 `a && a.b`。
- **Windows 上用 PowerShell 跑 build/test**。

## 3. 数据与增量逻辑

- miniapp 存储新增一个键 **`nianlun:analyzedIds`**：已分析好友 id 的字符串数组（与 `samples`/`recentInsights` 同层，本地存储，绝不含聊天原文）。
- 触发点：**导入成功后**（`import` store 的 `run()` 末尾，`setData` 之后）。
- 流程：
  1. 读出当前 `analyzedIds` 集合。
  2. 取当前全部好友中 **id 不在集合内** 的作为待分析列表。
  3. 逐个：`s = samples.loadSamplesFor(id)` → `sug = await aiClient.suggestFriend(friend, s)`。
     - `sug.rel || sug.role` 有值 → `data.updateFriend(id, { rel: sug.rel, role: sug.role })`，并把 id 加入集合。
     - 结果为空 → **跳过、不加入集合**（下次导入会重试）。
     - 抛异常 → 跳过、不加入集合、继续下一个（不中断整批）。
  4. 全部处理完，持久化更新后的 `analyzedIds`。
- 「记住」= 集合持久化。再次进入小程序**本身不触发**分析（避免打开即爆发大量调用）；只有导入这一动作会触发，且集合内的好友被跳过。
- 旧好友（本功能上线前已导入、不在集合里）如需补分析：重新导入一次即可。

## 4. 编排位置与接口

- 新增 miniapp adapter 函数（便于单测），签名示意：
  ```ts
  // packages/miniapp/src/adapters/roleAnalysis.ts
  export async function analyzeRolesForNew(deps: {
    friends: Friend[]
    analyzedIds: string[]
    loadSamples: (id: string) => string[]
    suggest: (f: Friend, samples: string[]) => Promise<FriendSuggestion>
    applyRole: (id: string, patch: { rel?: Relation; role?: string }) => void | Promise<void>
    onProgress?: (done: number, total: number) => void
  }): Promise<string[]>  // 返回更新后的 analyzedIds
  ```
  纯编排、依赖注入，不直接 import wx/aiClient/store，方便 mock 测试。
- storage 增 `saveAnalyzedIds`/`loadAnalyzedIds`（键 `nianlun:analyzedIds`，容错返回 `[]`）。
- import store 的 `run()` 在导入成功分支末尾（`setData` 之后、`status='done'` 之前）：读集合 → 调 `analyzeRolesForNew`（注入 `aiClient.suggestFriend`、`samples.loadSamplesFor`、`data.updateFriend`、`onProgress`）→ 存回集合 → 再置 `status='done'`。
- **进度反馈**：import store 新增一个响应式字段 `analyzing = ref<{ done: number; total: number } | null>(null)`；批量开始前置 `{done:0,total:N}`，`onProgress` 更新 `done`，结束置回 `null`。导入页据此显示「正在分析关系/职务 x/N…」。**批量分析阻塞在导入流程内**（`status` 分析期间仍为 `parsing`，跑完才 `done`）。好友极多时较慢，但仅对新好友、仅一次。`total===0`（无新好友）时不显示、不改变 `analyzing`。

## 5. UI 改动

- **删除「✦ 智能建议」按钮及其 `suggest()` 函数**：
  - 好友列表页 `packages/miniapp/src/pages/friends/friends.vue`（按钮 + 函数 + 相关 import 若无其他引用则清理）。
  - 好友详情页 `packages/miniapp/src/pages/friend-detail/friend-detail.vue`（按钮 + 函数）。
- **保留**：两页的「改关系」picker 与「职务/备注」手动输入框（手动纠正 AI 结果仍需要；去掉的是手动*分析*，不是手动*改字*）。
- 导入页：批量分析进行时根据 import store 的 `analyzing` 显示「正在分析关系/职务 x/N…」；完成后在 `warnings` 追加一行「已自动分析 N 位好友的关系/职务」。

## 6. 错误处理

- 逐个 try/catch：单个失败/超时 → 跳过、不入集合、继续；不抛致命错误。
- 网络/后端整体不可用 → 整批调用都失败，均跳过、集合不变，仅提示，不影响导入本身已完成。
- 空结果与失败都不入集合，保证「下次导入重试」。

## 7. 测试

- `roleAnalysis.test.ts`（纯函数 + 注入 mock）：
  - 只分析不在 `analyzedIds` 里的好友（已在的跳过、不调用 suggest）。
  - 成功（rel/role 有值）→ 调 applyRole 且 id 入集合。
  - 空结果 → 不 applyRole、id 不入集合。
  - suggest 抛异常 → 跳过、不入集合、后续好友继续。
  - 返回的集合 = 旧集合 ∪ 成功分析的 id。
- `storage.test.ts` 追加 `analyzedIds` 存取（含缺键返回 `[]`）。
- import store 测试：导入成功后调用了批量分析、集合被持久化。
- friends/friend-detail 删按钮无单测，靠 `build:mp-weixin` 编译 + 人工验证。

## 8. 边界与说明

- **成本**：批量 = 每个新好友一次 AI 调用；靠「增量 + 记住」把成本限制在「仅新好友、仅一次」。
- **不阻塞导入结果**：好友数据在分析前已 `setData` 落地；分析只是异步补 rel/role。
- **userEdited 交互**：`updateFriend` 写入会记 `userEdited.rel/role`，再次导入时 `mergeFriends` 保留——即 AI 写入的标签之后不会被重新导入的统计覆盖，也不会被再次自动分析（id 已在集合）。
- **顺序**：逐个串行调用（简单、避免并发打爆云函数）；好友极多时耗时较长但只发生一次。
