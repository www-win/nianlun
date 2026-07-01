# 情感倾向分析设计文档

- 日期：2026-07-01
- 状态：已通过头脑风暴评审
- 主题：小程序新增 AI 情感分析——好友详情页「单人情绪」+ 报告页「全年整体情绪」

## 1. 背景与目标

对标同类工具常见的「情感倾向分析」。年轮已具备 AI 基建（`aiClient → 云函数 aiProxy → gaccode`）、有界样本（`nianlun:samples`，每好友 ≤30 条）、发送前确认（`showModal`）。目标：加两处 AI 情感分析，均复用现有基建与隐私模式。

## 2. 范围

### 做
1. **好友详情页 · 单人情绪**：按钮触发 → 发这位好友的样本 → AI 返回 `{tone, summary}`（情绪基调短标签 + 一句说明）。
2. **报告页 · 全年整体情绪**：按钮触发 → 从聊得最多的前 ~10 位各取少量样本合并 → AI 返回一段中文整体情绪描述。

### 不做
本地词典情感、固定情绪档位（标签由 AI 自由发挥、鼓励多样）、逐月情绪曲线。

## 3. 架构与数据

复用 `aiClient → 云函数 → gaccode`；只在 core 加纯函数、miniapp 加适配器方法与页面按钮。

**core（`ai/sentiment.ts`，纯函数，web/小程序共用）**
- `buildFriendSentimentPrompt(friend, samples: string[]): string`
  - 让 AI 依据聚合统计 + 样本，输出**严格 JSON**：`{"tone":"<具体生动的情绪基调短词，鼓励多样，如 热络/暧昧/渐远/客套/无话不谈>","summary":"<一句话说明>"}`。
- `buildYearSentimentPrompt(report, sampleLines: string[]): string`
  - 让 AI 依据年度聚合 + 跨好友样本，写**一段** 80~150 字中文整体社交情绪描述，只输出正文。
- `parseSentiment(text): { tone?: string; summary?: string }`
  - 容错解析（剥围栏、定位首个 JSON、校验字段），无法解析返回 `{}`，永不抛异常（同 `parseFriendSuggestion` 风格）。

**miniapp**
- `aiClient.analyzeFriendSentiment(friend, samples): Promise<{tone?,summary?}>` = transport(buildFriendSentimentPrompt) → parseSentiment。
- `aiClient.analyzeYearSentiment(report, sampleLines): Promise<string>` = transport(buildYearSentimentPrompt) → 文本。
- `samples.gatherTopSamples(friends, opts?)`：按 msgCount 取前 `maxFriends`(默认 10) 位好友，各取前 `perFriend`(默认 4) 条样本，展平并截断到 `maxTotal`(默认 60) 条。可注入 storage、可单测。

## 4. 页面

- **好友详情页**：编辑区旁加「✦ 情绪分析」按钮 → `showModal` 确认（发约 N 条样本）→ `analyzeFriendSentiment` → 结果卡：`tone` 徽章 + `summary` 一句。加载态、失败 toast。
- **报告页**：加「✦ 全年情绪」按钮 → `showModal` 确认（发约 N 条样本）→ `gatherTopSamples` → `analyzeYearSentiment` → 一段文字卡。加载态、失败 toast。

## 5. 隐私

- 两处均**用户主动触发 + 发送前 showModal 确认**才发**有界样本**（聊天片段），与「智能建议」一致。
- 报告文案那种聚合信息不受影响；未触发时不发任何聊天内容。

## 6. 测试

- **core**：`buildFriendSentimentPrompt` 含好友名 + 要求 JSON；`parseSentiment` 容错（正常 JSON、带围栏、垃圾→{}）；`buildYearSentimentPrompt` 含年份 + 样本行。
- **miniapp**：`analyzeFriendSentiment`/`analyzeYearSentiment` 用注入 mock transport 测；`gatherTopSamples` 排序/取样/截断边界。
- 页面按钮真机验证。

## 7. 风险

- 情绪判断属 AI 主观推测，标签由 AI 自由发挥可能不稳定；`summary` 给出依据、页面标「AI 推测」。
- 全年样本合并需限量防 prompt 超长（`maxTotal` 截断），maxTokens 适中。
