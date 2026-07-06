# 好友情绪价值分析设计文档

- 日期：2026-07-06
- 状态：已通过头脑风暴评审，待转实现计划
- 主题：好友详情页「情绪价值分布 + 情绪波动 + 词语情感倾向」（本地词典全量算，我 vs TA 双栏）

## 1. 背景与目标

对标同类产品的「情侣研究报告 / 情感分析」版块（用户提供的参考图），其中与情绪直接相关的三块：

1. **情绪价值分布**：每人一个环形图（开心/平淡/难过 占比）+ 平均情绪值分数（如 0.524）。
2. **情绪波动分析**：随时间的情绪走势曲线。
3. **词语情感倾向分析**：高频词按正/负情感染色。

年轮现有情绪能力仅为好友详情页一个「✦ 情绪分析」AI 按钮，返回 `{tone, summary}`（一个情绪基调徽章 + 一句说明），偏轻。之前写过一份「逐月情绪折线 + 双方对比」spec（`2026-07-01-friend-mood-timeline-dual-sentiment-design.md`）但未落地，本设计一并覆盖。

目标：在**好友详情页**为「我 vs 这位好友」补上上述三块，**图表全部由本地情感词典对全部消息逐条打分聚合得出**（真实、离线、免费、不发任何聊天内容），AI 只保留现有按钮补一句解读。

## 2. 关键决策（头脑风暴已定）

1. **范围**：三块全做，尽量贴近参考图的完整「情绪分析」版块。
2. **情绪值来源 = 混合**：分布 / 占比 / 平均值 / 波动趋势用**本地词典全量算**；一句话解读沿用现有 AI 按钮。图表不依赖 AI。
3. **展示结构**：好友详情页，「我 / TA」双栏对比（对应参考图的 自己 / 对方）。
4. **词典策略 = 精简「聊天体」中文情感词典**：约 200–400 个正/负情绪词 + emoji + 重复/标点启发式，为微信口语调优、包体积小、可持续扩充。不引入大型学术词库（偏书面语、体积重）。

## 3. 架构与数据流

严格遵循单向依赖 `miniapp → core`；情绪打分是纯函数，放 core；**只在导入 Worker 内调用**（唯一能看到原始聊天 `Conversation[]` 的地方）。

```
导入 Worker
  core: parse → aggregate
    aggregate 对每条消息 scoreMessage(text)（纯函数，本地词典）
    按 from:'me'|'them' 两侧聚合 → Friend.emotion:
      · me / them: EmotionDist（开心/平淡/难过 计数 + total + avg 0..1）
      · monthly: { me, them }  各 12 点均值曲线（无消息月 = null）
      · words: 高频词 + 每词极性（对现有高频词查词典）
  → 存 Friend[]（含 emotion 聚合），原始消息仍不落盘
        ↓
好友详情页（只读 store，渲染）
  · 情绪价值分布：我/TA 两个 canvas 环形图 + 平均情绪值/占比小字
  · 情绪波动：canvas 双线折线（我暖 / TA冷），null 断开，含 0.5 中线
  · 词语情感倾向：现有高频词云按极性染色（暖=正/冷=负/灰=中性）
  · 顶部保留「✦ 情绪分析」AI 按钮 → 一句解读（唯一 AI，可选）
```

## 4. Core 改动（纯函数 + 测试）

### 4.1 `packages/core/src/stats/emotion.ts`（新增）

**词典数据**（模块内常量，可扩充）：
- `LEX: Record<string, number>`：情绪词 → 权重。普通 ±1、强烈 ±2（如 开心/喜欢/谢谢 = +1，爱/太棒了/幸福 = +2；烦/无聊 = -1，难受/滚/讨厌 = -2）。
- `EMOJI: Record<string, number>`：常见 emoji → 极性（😄🥰❤️😂 → 正，😭😡💔😔 → 负）。
- `NEG_WORDS`：否定词集合（不/没/别/无/非）。

**打分函数**：
```ts
scoreMessage(text: string): number
```
- 扫描文本：命中 `LEX` 词累加权重；命中 emoji 累加 `EMOJI` 值。
- 启发式：`哈{2,}`/嘻嘻/嘿嘿 → +1；`呜{2,}`/唉/emmm → -1；感叹号数量放大**同号**强度（每个 `!`/`！` 把当前净分绝对值 ×1.2，封顶）。
- 否定翻转：情绪词前一个小窗口（≤2 字）内出现 `NEG_WORDS` → 该词权重取反（简单窗口法，不做完整句法）。
- 返回原始净分 `raw`（可正可负、无固定范围）。

```ts
classify(raw: number): '开心' | '平淡' | '难过'   // raw > 0.5 → 开心；raw < -0.5 → 难过；否则 平淡
toValue(raw: number): number                      // 归一 0..1：0.5 + clamp(raw, -R, R)/(2R)，R=3，0.5=中性
```

**聚合辅助**：
```ts
emptyDist(): EmotionDist
addToDist(dist, raw): void          // 计数 + 累加 value，最后由 finalizeDist 求 avg
finalizeDist(dist): EmotionDist     // avg = Σvalue / total（total=0 时 avg=0.5）
mergeDist(a, b): EmotionDist        // 计数相加、avg 按 total 加权（多文件导入合并用）
```

### 4.2 `packages/core/src/model/types.ts`（扩展）

```ts
export interface EmotionDist {
  happy: number      // 开心 条数
  neutral: number    // 平淡 条数
  sad: number        // 难过 条数
  total: number
  avg: number        // 平均情绪值 0..1，0.5=中性
}
export interface FriendEmotion {
  me: EmotionDist
  them: EmotionDist
  monthly: { me: (number | null)[]; them: (number | null)[] }  // 长度 12，每月每侧均值(0..1)，无消息=null
  words: Array<{ word: string; count: number; polarity: number }> // polarity -1..1，不在词典=0
}
```
`Friend` 增加可选字段 `emotion?: FriendEmotion`（老数据无此字段时页面隐藏对应卡片）。

### 4.3 `packages/core/src/stats/aggregate.ts`（改动）

在既有逐消息遍历中，对每条消息：
- `raw = scoreMessage(msg.text)`；按 `msg.from` 累加到 `me`/`them` 的 `EmotionDist`。
- 按 `msg.ts` 的月份累加到 `monthly[side][month]`（累加 value 与计数，收尾求均值；无消息月保持 `null`）。
遍历后：`finalizeDist` 收尾；`words` = 对已算出的高频词逐个 `LEX` 查表得 polarity（归一到 -1..1，不在词典为 0）。产出挂到 `Friend.emotion`。

### 4.4 合并 `packages/core/src/merge/merge.ts`（改动）

`mergeFriends` 合并两个 `Friend.emotion`：`me`/`them` 用 `mergeDist`；`monthly` 按每月条数加权合并（一侧 null 则取另一侧）；`words` 按现有高频词合并规则重算极性。保证多文件导入结果确定、可复现，且不依赖已丢弃的原始消息。

### 4.5 `packages/core/src/index.ts`

导出 `EmotionDist`、`FriendEmotion`、`scoreMessage`、`classify`、`toValue`（供测试与 miniapp 复用）。

## 5. miniapp 改动

### 5.1 `packages/miniapp/src/lib/insights.ts`（新增纯函数，供页面绘制 + 单测）
- `donutSegments(dist: EmotionDist): Array<{ label; value; frac; color; startAngle; endAngle }>` —— 三色环形图的弧段（开心暖 / 平淡灰 / 难过冷）。
- `moodDualLinePoints(monthly, opts): { me: Pt[]; them: Pt[]; breaks }` —— 双线折线坐标，null 处断开（参考已废弃 spec 的 `moodLinePoints` 思路）。

### 5.2 `packages/miniapp/src/pages/friend-detail/friend-detail.vue`（改动）
- **情绪价值分布卡**（`v-if="friend.emotion"`）：`我 / TA` 两栏 flex，各一个 `<canvas>` 环形图（`donutSegments` 绘制）+ 小字「平均情绪值 0.52 · 开心 38% / 平淡 50% / 难过 12%」。
- **情绪波动卡**（`v-if` monthly 有非 null）：一个 `<canvas>` 双线折线（`moodDualLinePoints`），含 0.5 中线、月份刻度、图例（我/TA），标「本地统计」。全 null 时显示「样本不足」。
- **词语情感倾向**：升级现有「高频词」云 —— 用 `friend.emotion.words` 的 polarity 给每个词染色（暖=正、冷=负、灰=中性），字号仍按词频层级。
- 顶部现有「✦ 情绪分析」AI 按钮与 `{tone, summary}` 结果卡保持不变。

canvas 画法参考 `report.vue` 既有离屏 canvas 用法；小程序 canvas 需 `canvas-id` + `uni.createCanvasContext`。

## 6. 隐私

- 三块图表全部**本地全量算**，导入时算好、只存聚合结果（计数/均值/极性），**原始聊天照旧不落盘、不上传**。
- 未点 AI 按钮时不发送任何聊天内容；点按钮走现有「发送前 showModal 确认 + 有界样本」流程，本设计不改动 AI 部分。

## 7. 边界与错误处理

- `Friend.emotion` 不存在（老数据）→ 两张新卡隐藏，页面其余正常。
- 某侧 `total = 0`（如全是自己发）→ 该侧环形图显示「暂无」，avg 记 0.5。
- monthly 全 null → 波动卡显示「样本不足，暂无法生成情绪走势」，不画空图。
- `scoreMessage` 对空串 / 纯符号 / 表情包占位返回 0（平淡），永不抛异常。
- 词典误判风险：图表标「本地词典估算，仅供参考」；口语场景由 emoji/重复启发式兜底。

## 8. 测试

- `packages/core/src/stats/__tests__/emotion.test.ts`：`scoreMessage`（正词/负词/emoji/否定翻转/重复哈哈/感叹号放大/空串）、`classify` 与 `toValue` 边界（±阈值、极值、中性 0.5）、`mergeDist` 加权。
- `packages/core/src/stats/__tests__/aggregate.test.ts`（扩展）：构造含 me/them 双向、多月消息的 `Conversation`，断言 `emotion.me/them` 计数与 avg、`monthly` 的 null 与均值、`words` 极性。
- `packages/core/src/merge/__tests__/merge.test.ts`（扩展）：两个带 emotion 的 Friend 合并后计数相加、avg 加权、monthly 合并正确。
- `packages/miniapp/src/lib/__tests__/insights.test.ts`（扩展）：`donutSegments`（三段角度和为 2π、颜色映射、total=0）、`moodDualLinePoints`（全 null、部分 null、边界 0/1）。
- 页面：真机验证两张卡渲染、canvas 环形/折线、词云染色、老数据无 emotion 时隐藏。

## 9. 不在本次范围

- 报告页「全年整体情绪分布/波动」（本次只做好友详情页；后续可复用 core 聚合）。
- AI 逐月情绪推断（已改为本地词典全量算，更真实）。
- 情绪雷达图 / 情绪价值散点 / 深度关系长文（参考图其它版块，非本次「情绪」范围）。
- 大型学术情感词库、可训练模型、词典的用户自定义扩展 UI。
