# AI 好友画像（含金融投资偏好）设计

> **状态：** 已通过 brainstorming 评审，待写实现计划。
> **依赖链：** 严格 `miniapp → core`。改 core 后需 `pnpm --filter @nianlun/core build`（用 PowerShell，避免中文变 `?`）才能让 miniapp 解析新 dist。

## 1. 目标

在好友详情页新增「✦ 好友画像」按钮，一次 AI 调用推断该好友的 **5 个侧面**，渲染成一张画像卡：

| 侧面 | 输出 |
|---|---|
| 身份/职业 | 一句结论短句（如「某银行支行长」「中学老师」） |
| 家庭状况 | 一句结论短句 |
| 感情状态 | 一句结论短句 |
| 生活方式 | 一句结论短句 |
| **投资偏好** | 一句总述 + 4 个子维度短句：风险偏好 / 关注品类 / 财富与可投线索 / 决策风格与周期 |

**背景：** 目标用户是金融从业者，用它理解每个微信好友的投资倾向（个人 CRM / 客户洞察）。投资偏好是核心诉求，故比其余侧面展示更细。

## 2. 全局约束

- 注释/文案用**中文**。
- `@nianlun/core` 是纯函数库：**不碰 DOM/window/网络/vue**；解析器**容错、永不抛异常**（坏数据降级）。
- 依赖链严格 `miniapp → core`。改 core 后 miniapp 解析的是 **dist**，故 miniapp 任务前必须 `pnpm --filter @nianlun/core build`。
- **单次 AI 调用返回全部内容**；结果**不持久化**（与现有 tone/summary、深度情绪一致，刷新后归空，需重新点击）。
- 只用**有界样本**（复用 `extractFriendSamples`），不改「聊天原文不落盘」的铁律。
- 任一侧面/子维度**样本中无可靠线索时输出「暂无足够线索」，禁止臆测**（尤其感情/家庭/财富）。
- 画像卡底部标注「AI 推测，仅供参考」。
- **Windows 上用 PowerShell 跑 build/test**。

## 3. 架构（沿用深度情绪那套 = 独立新功能，方式 A）

- **core**（纯函数）：新增 `packages/core/src/ai/profile.ts`
  - `buildFriendProfilePrompt(friend: Friend, samples: string[]): string` —— 组织聚合统计 + 有界样本，要求 AI 输出严格 JSON。
  - `parseFriendProfile(text: string): FriendProfile` —— 容错解析：剥围栏、定位首尾花括号、逐字段取非空字符串，**永不抛异常**，垃圾输入返回 `{}`。
  - `packages/core/src/index.ts` 导出上述函数与类型 `FriendProfile`、`InvestmentProfile`。
- **miniapp**：`packages/miniapp/src/adapters/aiClient.ts` 新增
  `analyzeFriendProfile(friend, samples): Promise<FriendProfile>`，复用现有 transport（`maxTokens` 1024）。
- **miniapp**：`packages/miniapp/src/pages/friend-detail/friend-detail.vue` 新增按钮 + 画像卡（无新纯函数，逻辑已在 core 覆盖）。

不改动现有情绪分析 / 关系建议，纯新增，零回归风险。

## 4. 数据结构（core）

```typescript
export interface InvestmentProfile {
  summary?: string      // 一句总述
  risk?: string         // 风险偏好：保守/稳健/平衡/进取…
  categories?: string   // 关注品类：股票/基金/房产/保险/黄金/存款/加密…
  wealth?: string       // 财富与可投线索
  style?: string        // 决策风格与周期：自主/听建议、长线/短线/投机
}

export interface FriendProfile {
  identity?: string     // 身份/职业
  family?: string       // 家庭状况
  romance?: string      // 感情状态
  lifestyle?: string    // 生活方式
  investment?: InvestmentProfile
}
```

- 所有字段可选：AI 未给或给空串则省略；`parseFriendProfile` 只接受非空字符串、`trim()` 后存入。
- `investment` 若其内部 5 个字段全无有效值，则整个 `investment` 省略（解析层与深度情绪 `me`/`them` 一致）。
- **解析层省略缺失字段，展示层负责占位**：页面对缺失字段统一显示「暂无足够线索」（见第 6 节渲染规则）。

## 5. Prompt 要点

- 角色：擅长从聊天推断人物背景的观察者；**只输出严格 JSON、无代码围栏外文字**。
- 内嵌 JSON 结构模板，逐字段标注含义，投资偏好列出 4 子维度。
- 强约束：**任一字段若样本中无可靠线索，值填「暂无足够线索」，禁止臆测**。
- 投资偏好子维度贴合金融从业者视角（风险偏好、关注品类、财富与可投线索、决策风格与周期）。
- 输入统计：`displayName`（alias||name）、`rel`、`role`、`msgCount`、`sentRatio%`、`peakPeriod`。
- 输入样本：有界聊天样本，逐条带「我 / 对方」方向标注（`extractFriendSamples` 产物）。

## 6. 页面 UI（friend-detail.vue）

- 情绪分析卡下方新增「✦ 好友画像」按钮；点击 → loading → 渲染画像卡。
- 卡片：
  - 前 4 个侧面各一行「标题 + 短句」。
  - **投资偏好**单独一个高亮子块（金融是核心诉求），**总是展示**（即使 core 解析层省略了整个 `investment`）：一行总述 + 4 行固定子维度（风险偏好 / 关注品类 / 财富线索 / 决策风格）；任一行对应字段缺失即显示「暂无足够线索」。
  - **渲染规则（统一）**：前 4 个侧面与投资子维度，凡 `FriendProfile` 中缺失或为空的字段，展示层一律渲染「暂无足够线索」。投资子块整体常驻不隐藏；前 4 个侧面行同样常驻。
  - 卡片底部「AI 推测，仅供参考」。
- 沿用现有卡片 class 与配色变量（`--accent-wash` / `--muted` / `--fg` 等），不新造设计语言。
- 与情绪分析一致：不持久化，刷新后需重新点击。

## 7. 测试（TDD）

**core `profile.test.ts`：**
- `buildFriendProfilePrompt`：含好友名；含 5 个侧面关键字（identity/family/romance/lifestyle/investment）与投资 4 子维度（risk/categories/wealth/style）；含「暂无足够线索」约束语；含逐条样本。
- `parseFriendProfile`：
  - 完整对象（含嵌套 investment）正确解析。
  - 剥代码围栏后仍能解析。
  - 缺字段时省略该字段（不出现在结果里）。
  - `investment` 部分子字段缺失时保留有值的、省略空的；全缺时整个 `investment` 省略。
  - 空串字段被过滤。
  - 垃圾输入 / 空串返回 `{}`，永不抛异常。

**miniapp `aiClient.test.ts`：**
- `analyzeFriendProfile` 用 mock transport 返回结构化 JSON，断言解析出 5 侧面 + 投资子维度，且 prompt 含 `investment`。

**构建：** core 改动后 `pnpm --filter @nianlun/core build`；friend-detail 页无单测，靠 `build:mp-weixin` + 微信开发者工具手测。

## 8. 隐私与边界

- 只用有界样本；画像结果不落盘；不改动原文不落盘铁律。
- 敏感侧面（感情/家庭/财富）靠 prompt「无线索即坦白」约束兜底，宁缺毋编。
- 授权前提：用户分析的是自己拥有的聊天记录，属正当的个人 CRM 用途。
- **信息不足**：任一侧面/子维度可显示「暂无足够线索」；投资子块常驻，全空时 5 行皆为占位（见第 6 节渲染规则），不做隐藏。
