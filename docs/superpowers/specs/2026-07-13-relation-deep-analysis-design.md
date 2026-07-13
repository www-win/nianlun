# 深度关系分析（Relation Deep）模块设计

- 日期：2026-07-13
- 状态：已定稿，待实现
- 作者：与用户 brainstorming 共同定稿

## 背景与目标

现有海报里的「深度关系分析」只是一张外部原型/设计稿（open-design 里并无实现），当前 miniapp
代码中并不存在。好友详情页现有的 AI 分析块（好友画像、MBTI、星座、全年情绪、投资画像）方向偏
「金融客户视角」，心理深度不足。

本设计把「深度关系分析」做成一个**独立、per-friend、可导出长海报**的正式模块，并在原型 6 块基础上
**加深到 10 块**——新增 4 个心理维度。用户诉求关键词：**内容更深、独立可导出长海报**。

选定路线（brainstorming 结论）：**路线 A —— 内容优先，海报为「文字长图」**。
不追求逐像素还原原型里的词云/雷达/散点等高成本图表，把工程力气花在心理内容深度与可控的导出上。

## 架构与数据流

严格遵守单向依赖 `miniapp → core`，core 保持纯函数、绝不碰 DOM / window / IndexedDB。

```
friend-detail 页  ──「✦ 深度关系分析」──▶  relation-deep 页(新)
                                             │
     samples.loadSamplesFor(id) + friend 统计 │
                                             ▼
   aiClient ──▶ cloudfunctions/aiProxy ──▶ AI 服务
                                             │ 一份大 JSON(10块)
                          core: parseRelationDeep(text) 容错解析
                                             ▼
     渲染 10 块卡片  +  复用已缓存的 DeepSentiment 逐月 timeline 画"安全感曲线"
                                             │
                      canvas 文字长海报 ──▶ 存相册/分享
```

- **core 新文件** `packages/core/src/ai/relationDeep.ts`：`RelationDeep` 类型 +
  `buildRelationDeepPrompt(friend, samples)` + `parseRelationDeep(text)`，并在 `index.ts` 导出。
  解析器容错：剥代码围栏、定位首尾花括号、逐块取值、坏 JSON / 非字符串入参一律返回 `{}`，**永不抛异常**
  （与 `profile.ts` / `sentiment.ts` 同款风格）。
- **miniapp 新页** `packages/miniapp/src/pages/relation-deep/relation-deep.vue`：从 friend-detail 传
  `id` 进入；有缓存直显、过期打标、可重新生成；底部「保存长海报」。
- **入口**：friend-detail 页新增一枚「✦ 深度关系分析」动作，跳转到 relation-deep 页并带上好友 `id`。
- **数据复用**：`security`（安全感曲线）的**图表**复用 core 现有 `buildFriendDeepSentimentPrompt`
  产出的 `DeepSentiment.timeline`（逐月情绪走势）——若该好友已缓存 DeepSentiment 则直接画折线；
  未缓存则只显示 AI 叙述文字，不强制二次调用。

## 隐私

- 只发送该好友的**有界样本**（`samples.loadSamplesFor(id)`）与聚合统计（msgCount、sentRatio、
  peakPeriod、monthly 等），发送前弹 `uni.showModal` 确认框，告知将发送约 N 条聊天片段。
- **原始聊天绝不落盘**；海报只把生成的图片存到相册。分析结果 JSON 按好友缓存于 `meta` 库。

## 内容与 JSON 结构（10 块）

一次 AI 调用产出下面这份 JSON（6 原有 + 4 新增）。每块要求 AI **给依据、引原句**，
无线索填「暂无足够线索」，**禁止臆测**（尤其感情、家庭等敏感面）。

```ts
interface RelationDeep {
  overall?: string                          // ① 整体评估：一段定调
  attachment?: {                            // ② 依恋风格
    me?: { style?: string; desc?: string }  //   如 焦虑型/回避型/安全型 + 解读
    other?: { style?: string; desc?: string }
  }
  interaction?: {                           // ③ 互动模式
    initiative?: string                     //   沟通主动性
    expression?: string                     //   情感表达差异
    conflict?: string                       //   冲突处理(追逐-回避等模型)
  }
  needs?: { me?: string; other?: string }   // ④ 情感需求（各自深层需求）
  uniqueness?: {                            // ⑤ 关系独特性
    sharedMemory?: string; ritual?: string  //   共同记忆 / 互动仪式
  }
  // ▼▼▼ 4 个新增维度 ▼▼▼
  security?: {                              // ⑥ 安全感/信任曲线
    summary?: string
    turningPoints?: { month?: number; event?: string; direction?: '上升' | '下降' }[]
  }                                         //   图表复用已缓存的逐月情绪 timeline
  power?: {                                 // ⑦ 权力/主导权
    summary?: string; whoLeads?: string; dependency?: string
  }
  triggers?: {                              // ⑧ 情绪触发点（各自雷区+反应）
    me?: { trigger?: string; reaction?: string }[]
    other?: { trigger?: string; reaction?: string }[]
  }
  language?: {                              // ⑨ 沟通语言模式
    appellation?: string   // 称呼
    catchphrases?: string  // 口头禅
    emoji?: string         // 表情包习惯
    latency?: string       // 回复时延节奏
  }
  suggestions?: {                           // ⑩ 优化建议（问题/建议成对）
    topic?: string; problem?: string; advice?: string
  }[]
}
```

理论内核（写进 prompt 引导，不硬编码结论）：成人依恋理论（焦虑型/回避型/安全型）、
追逐-回避（Demand-Withdraw）冲突模型、非暴力沟通（NVC）用于优化建议。

## 页面呈现（relation-deep.vue）

还原原型卡片风格：

- 顶部：好友名 + 关系标签 + 「整体评估」蓝色横幅（对应原型顶部大框）。
- 主体 10 块，双栏/单栏混排：依恋、互动、需求、独特性走双栏；整体评估、优化建议走通栏。
  - **安全感/信任曲线**：块内挂一张逐月折线小图（复用 friend-detail `drawMood` 的 canvas 折线套路
    + 已缓存 `DeepSentiment.timeline`）；无缓存只显示叙述文字。
  - **优化建议**：红「问题」/ 绿「建议」双色卡（同原型）。
- 状态：加载中 / 空结果可重试 / 过期打标「数据已更新，点重新生成」——沿用 friend-detail 现有交互与样式类。

## canvas 长海报导出

走 `report.vue` 现成的 `canvasToTempFilePath → saveImageToPhotosAlbum` 套路：

- 离屏 canvas，固定宽（CW=640），**高度按内容动态算**：逐块 `wrapLines` 预折行、累加行高得到 CH，
  内容多长画多高，**不写死巨图**，控制真机内存。
- 画法：米色底 + 描边（沿用现有视觉）→ 顶部好友名/年份 → 逐块画彩色小标题 + 折行正文；
  安全感块顺带把折线小图画进去；优化建议画红/绿两栏。
- 词云/雷达/散点等高成本图**不进导出图**（路线 A 取舍）。
- 抽 `drawBlock(title, bodyLines, y)` 辅助函数顺序下推 y 坐标，保持代码聚焦、可读。

## 缓存与失效

沿用 `saveFriendMbti / loadFriendMbti` 模式：

- `storage.saveRelationDeep(friendId, friend, data)` / `loadRelationDeep(friendId)` → 存 `meta` 库。
- 按好友指纹（msgCount 等）判过期，返回 `{ data, stale }`。
- 空结果不写盘、允许重试。

## 测试策略（Vitest）

- core `relationDeep.test.ts`：
  - `buildRelationDeepPrompt` 含关键约束（10 块字段名、引原句要求、「暂无足够线索」、样本行注入）。
  - `parseRelationDeep` 容错：正常 JSON、带代码围栏、缺块、嵌套数组、坏 JSON→`{}`、
    非字符串入参→`{}`，**永不抛异常**。
- miniapp `relation-deep` 页测试：有缓存直显 10 块、过期打标、空结果可重试。
- `storage` 往返测试（saveRelationDeep/loadRelationDeep）。
- aiClient 新方法（`analyzeRelationDeep`）mock 测试。

## 明确的非目标（YAGNI）

- 不逐像素还原原型全图表海报（词云/雷达/散点不做进导出图）。
- 不做多好友批量分析、不做全局关系模式总览（本设计只针对单个好友）。
- 不新增第二次 AI 调用来单独算安全感曲线——复用已缓存的 DeepSentiment timeline。
