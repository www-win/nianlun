# 好友详情页：情绪波动折线 + 双方情绪对比

日期：2026-07-01
状态：已确认，待转实现计划
分支：feat/recent-month-friend-detail

## 背景与目标

竞品（小红书上的付费微信聊天记录分析）在「情感分析」里提供两个年轮尚缺的角度：

- **情绪波动折线**：随时间的情绪走势曲线。
- **双方情绪对比**：把「我」和「对方」的情绪分开呈现、并排比较。

本设计在**好友详情页（friend-detail）**为单个好友补上这两块，对象是「我 vs 这位好友」。定位与年轮既有风格一致：本地优先、AI 结果标注「仅供参考」。

## 现状（复用基础）

- 情感分析纯函数在 `packages/core/src/ai/sentiment.ts`：`buildFriendSentimentPrompt` 生成 prompt，`parseSentiment` 容错解析出 `{tone, summary}`，**永不抛异常**。
- AI 调用链：friend-detail 的「✦ 情绪分析」按钮 → `aiClient.analyzeFriendSentiment` → transport → 云函数 `aiProxy`。当前只返回 `{tone, summary}`，结果存内存 ref，刷新即丢，**不持久化**。
- 数据模型 `Friend`（`packages/core/src/model/types.ts`）有 `monthly: number[12]`（逐月消息数），但**无逐时间段情绪值**。样本每好友 ≤30 条文本片段，每条带方向标注（"我：…"/"对方：…"），**不带月份归属**。
- 图表均为纯 CSS（柱状/热力图/标签云）；`report.vue` 有离屏 canvas 用法（导出海报）可参考。可复用纯函数在 `packages/miniapp/src/lib/insights.ts`。

## 关键决策

1. **单次 AI 调用**：把现有「情绪分析」按钮升级为一次调用返回全部三块（整体 tone/summary + timeline + 双方对比），**不新增 AI 调用次数**，省云函数额度，复用现有按钮/loading/免责声明。
2. **折线用 canvas**：小程序纯 CSS 画斜线不现实；canvas 参考 `report.vue`。
3. **暂不持久化**：与现有 tone/summary 一致（点按钮才算、刷新即丢）。持久化属独立改进，本次不做（YAGNI）。
4. **逐月情绪本质是 AI 推断**：样本仅 30 条且不带月份，逐月情绪无可靠原始数据，只能由 AI 基于样本 + 逐月消息数推测，UI 明确标注「AI 推测，仅供参考」。

## 数据契约

升级后 AI 返回的 JSON（parser 对缺字段/坏 JSON 一律降级，绝不抛异常）：

```json
{
  "tone": "热情随和",
  "summary": "一句话，20-40字",
  "timeline": [ { "m": 1, "score": 40 }, { "m": 2, "score": null }, ... ],
  "me":   { "tone": "主动", "summary": "……" },
  "them": { "tone": "克制", "summary": "……" }
}
```

- `timeline`：长度 12，`m` 为月份 1–12，`score` 为情绪分值 **-100（消极）～ +100（积极）**，0 为中线。
- **无消息的月 `score` 为 `null`**，折线在该处断开，不画假数据（避免长期无联系被编成平线）。喂给 AI 的 prompt 会带上 `monthly[12]`，告知哪些月有互动。
- `me` / `them`：分别为「我」「对方」的 `{tone, summary}`，靠样本方向标注区分。

## 组件与改动（core → miniapp 单向依赖）

### core（纯函数 + 测试）

- `packages/core/src/ai/sentiment.ts`
  - 新增 `buildFriendDeepSentimentPrompt(friend, samples)`：在现有 prompt 基础上追加 timeline + me/them 的输出要求，并把 `friend.monthly` 逐月消息数写入 prompt。
  - 新增 `parseDeepSentiment(text): DeepSentiment`：容错解析 timeline/me/them；坏数据降级（timeline→`[]`，me/them→`undefined`），永不抛异常。
  - 扩展类型：`DeepSentiment { tone?; summary?; timeline?: Array<{m:number; score:number|null}>; me?: Sentiment; them?: Sentiment }`。
  - `packages/core/src/index.ts` 导出新函数/类型。

### miniapp

- `packages/miniapp/src/adapters/aiClient.ts`：`analyzeFriendSentiment` 改用 `buildFriendDeepSentimentPrompt` + `parseDeepSentiment`，返回 `DeepSentiment`（对旧字段向后兼容）。
- `packages/miniapp/src/lib/insights.ts`：新增纯函数 `moodLinePoints(timeline, opts)` → 把 12 点（含 null）映射为 canvas 折线坐标序列 + 断点标记；供页面绘制与单测。
- `packages/miniapp/src/pages/friend-detail/friend-detail.vue`：
  - 折线：`<canvas>` 按 `moodLinePoints` 绘制，null 处断开；含 0 中线、月份刻度、「AI 推测，仅供参考」。
  - 双方对比：两栏 flex「我 / TA」，各一个情绪基调徽章（复用现有 `.senti` 徽章样式）+ 一句说明。
  - 整体 tone/summary 保留为顶部总览。

## 边界与错误处理

- AI 返回坏 JSON / 缺字段 → parser 降级；页面对应块隐藏或显示占位，其余块正常。
- timeline 全 `null`（几乎无有效样本）→ 折线区显示「样本不足，暂无法生成情绪走势」，不画空图。
- 单次调用失败 → 沿用现有错误提示与重试入口，三块一起失败（因是同一次调用）。

## 测试

- `packages/core/src/ai/__tests__/sentiment.test.ts`：
  - `buildFriendDeepSentimentPrompt` 含 timeline/me/them 关键字与 `monthly` 数据。
  - `parseDeepSentiment` 对完整 JSON、带代码围栏、半截/坏 JSON、缺字段的容错。
- `packages/miniapp/src/lib/__tests__/insights.test.ts`：`moodLinePoints` 覆盖全 null、部分 null、边界值（±100、0）。
- `packages/miniapp/src/adapters/__tests__/aiClient.test.ts`：mock transport 断言走新 prompt、返回 `DeepSentiment`。

## 不在本次范围

- 情绪值持久化（storage 扩展）。
- 年度报告页的全年情绪走势。
- 正/中/负三档分布环形图、情绪指数分值等更重的对比形态（已选「基调短词 + 一句说明」）。
