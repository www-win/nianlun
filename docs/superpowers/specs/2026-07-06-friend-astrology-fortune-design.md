# 好友命理运势分析（八字 / 流月流日 / 合盘）设计

> **状态：** 已通过 brainstorming 评审，待写实现计划。
> **依赖链：** 严格 `miniapp → core`。改 core 后需 `pnpm --filter @nianlun/core build`（用 PowerShell，避免中文变 `?`）才能让 miniapp 解析新 dist。
> **来源：** 2026-07-06 客户会议录音（"运势及班次分析相关待办"）整理而来。

## 0. 需求来源（客户原话解读）

客户诉求是一条**命理/玄学画像 + 社交决策辅助**线，本质不是算命，而是"判断某个好友近期该靠近还是该远离，并和『我』做相冲比对"。逐条对齐：

| 客户原话 | 落到的功能 |
|---|---|
| "流月流日的分析" | 好友近期（本月/近几日）运势 |
| "盘，然后合盘分析" | 好友本命盘 + 与「我」的合盘相性 |
| "八字、MBTI、性格分析" | 命盘 + 性格解读（MBTI 味道并入性格段） |
| "运势是不是对称…运势不好离他远一点，好就靠近" | 相性解读 + 社交结论（宜亲近/宜保持距离） |
| "跟我的班次对比有没有冲课的（超级重要）" | **命理术语**：好友流日与「我」的值日/流日**相冲**判定 |
| "塔罗牌占卜记录…聊天记录里有吗" | **暂缓/砍**：前提（聊天里真有塔罗内容）不成立时功能为空，YAGNI |

**三个已锁定的关键决策：**
1. **"班次/冲课" = 命理术语（值日/流日相冲）**，不是工作排班日程。
2. **数据来源 = 混合**：AI 能从聊天抽就抽，抽不到走好友详情页手动补录生辰。
3. **命理计算 = `core` 历法引擎确定性排盘 + AI 只做解读**（不让 AI 自己算干支）。

## 1. 目标

在好友详情页新增「☯ 命理运势」卡，围绕好友的**生辰**给出：命盘速览 + 性格 + 近期运势（流月流日）+ 与「我」的相性（合盘 / 流日相冲）+ 社交提示（宜亲近 / 宜保持距离）。

命理排盘走 `core` 确定性历法引擎；吉凶与社交结论的自然语言解读走 AI。定位为**娱乐向参考**，强免责。

## 2. 范围切分

| 版本 | 内容 | 覆盖客户诉求 |
|---|---|---|
| **第一版（本 spec）** | 历法地基 + 「我的命盘」设置 + 好友生辰补录/抽取 + 好友详情页「命理运势卡」 | 流月流日、合盘、八字/性格、社交提示、流日相冲（客户核心全覆盖） |
| 第二版（后续 spec） | 首页/概览「今日提醒」聚合——把所有好友里近期该保持距离的一眼挑出来 | 社交提示的聚合体验 |
| 暂缓 / 砍 | 塔罗记录归集（依赖聊天里真有塔罗内容，价值不确定） | — |

## 3. 全局约束

- 注释/文案用**中文**。
- `@nianlun/core` 是纯函数库：**不碰 DOM/window/网络/vue**；`tsconfig` 的 `lib: ["ES2020"]` + `types: []` 会在编译期强制这一点。历法层必须是纯确定性函数。
- 依赖链严格 `miniapp → core`。改 core 后 miniapp 解析的是 **dist**，故 miniapp 任务前必须 `pnpm --filter @nianlun/core build`。
- **单次 AI 调用返回全部解读**；**AI 解读结果持久化**（存本地 IndexedDB，刷新后直接展示，无需重新点击——这是本功能与 tone/summary、好友画像"不持久化"的**有意差异**）。因流月流日运势随日期变化，持久化时一并记录**生成日期 + 生辰/我的盘指纹**；读取时若已跨天或生辰/我的盘已变，则**仍展示缓存结果**并在卡顶提示「基于 X 月 X 日生成，点击刷新更新」，**不自动清空、不强制重算**（见第 8.3 节）。
- **生辰是结构化字段、可持久化**（用户主动填/AI 抽取后确认），存本地 IndexedDB；这不违反"聊天原文不落盘"铁律——落盘的是生辰数字，不是聊天原文。
- 发给 AI 的只有**算好的结构化盘**（干支/五行/合盘结果）+ 抽生辰时的**有界样本**；**不发聊天原文**。
- 命理结论**仅供娱乐参考**；「宜保持距离」类社交建议**措辞软化**，定位"提个醒"而非"判决"。
- **Windows 上用 PowerShell 跑 build/test**。

## 4. 架构（沿用好友画像那套 + 新增历法层）

现有「好友画像」= `core/ai/profile.ts`（组 prompt + 容错解析）→ 好友详情页渲染卡。命理功能同构，但多一个**确定性历法层**：

```
core/astrology/            ← 新增，纯函数、确定性、无 DOM
  ├─ types.ts     BirthInfo / BaziChart / DayFortune / Compatibility
  ├─ chart.ts     排八字盘：生辰 → 四柱干支/五行/生肖/星座（引 lunar-javascript）
  ├─ fortune.ts   流月流日：某日期 → 干支，与本命盘日主的生克
  └─ compat.ts    合盘：两盘的六合/相冲/相刑/相害 + 生克（固定对照表，纯查表）
core/ai/astro.ts           ← 结构化盘 → prompt → AI 出「性格 / 运势 / 相性 / 社交结论」解读
```

- `core/index.ts` 导出上述函数与类型。
- **miniapp**：`adapters/aiClient.ts` 新增 `analyzeAstro(chart, fortune, compat, friend): Promise<AstroReading>`，复用现有 transport。
- **miniapp**：好友详情页新增按钮 + 命理运势卡；新增「我的命盘」设置入口（`meta` 库新键 `myBazi`）；好友生辰补录/抽取表单。
- **miniapp**：`adapters/storage.ts` 新增 `saveAstroReading` / `loadAstroReading`（类比现有 `saveSamples`/`loadSamples`，存 `meta` 库），持久化 AI 解读及其时效元数据。

不改动现有情绪分析 / 好友画像 / 关系建议，纯新增，零回归风险。

### 依赖验证（实现计划阶段先做）

`lunar-javascript` 是纯 JS、自带 `.d.ts`、无 DOM 依赖，理论上符合 `core` 约束。**实现计划第一步必须验证**它在 core 的 `types: []` + tsup ESM 打包下能干净构建、能被 miniapp 解析。若不行，退路是抽取所需子集或换等价纯函数历法算法。

## 5. 数据结构（core）

```typescript
// core/astrology/types.ts
export interface BirthInfo {
  year: number
  month: number
  day: number
  hour?: number            // 时辰(0-23)，可选；缺则八字无时柱→只能粗算，UI 提示
  isLunar?: boolean        // 输入按农历(默认公历)
  gender?: 'male' | 'female'
}

export interface BaziChart {
  pillars: {               // 四柱干支
    year: string
    month: string
    day: string
    hour?: string          // 时辰缺失时省略
  }
  dayMaster: string        // 日主天干
  fiveElements: Record<string, number>  // 五行分布(木火土金水计数)
  zodiac: string           // 生肖
  constellation: string    // 西洋星座(公历直接算)
}

export interface DayFortune {
  ganzhi: string           // 当日/当月干支
  relation: string         // 与本命日主的生克：生/克/比/泄/耗
}

export interface Compatibility {
  harmonies: string[]      // 六合/三合
  clashes: string[]        // 相冲/相刑/相害 ← "冲课"落在这里
}
```

- 生辰缺 `hour` 时，`pillars.hour` 省略，排盘只出三柱；UI 标注"未含时柱，结果偏粗"。
- 好友生辰未知时整个 `BirthInfo` 为空 → 走补录流程，不排盘。

## 6. 历法层（确定性、纯函数）

- **`chart.ts` — `buildBaziChart(birth: BirthInfo): BaziChart`**
  引 lunar-javascript：由公历/农历生辰取四柱干支、生肖；星座按公历月日查表。五行分布按四柱天干地支的五行归属计数。**纯确定性，不碰 AI。**
- **`fortune.ts` — `getDayFortune(date, chart): DayFortune`** / `getMonthFortune(...)`
  某日期 → 干支（lunar 提供）；与本命日主天干的生克按**固定五行生克表**判定（生/克/比/泄/耗）。
- **`compat.ts` — `getCompatibility(a: BaziChart, b: BaziChart): Compatibility`**
  生肖六合/相冲/相刑/相害、天干地支生克——全是**固定对照表**，纯查表。这是"班次/冲课"的判定引擎。相冲入 `clashes`，六合三合入 `harmonies`。

历法层不依赖 AI、不依赖网络，输入生辰/日期、输出结构化盘，可完全离线单测。

## 7. AI 解读层（core/ai/astro.ts）

- **`buildAstroPrompt(chart, fortune, compat, friend): string`**
  把**算好的结构化盘**（四柱/五行/生肖/星座）+ 流月流日干支与生克 + 合盘六合/相冲结果，连同好友统计（displayName/rel/role）组进 prompt。
  - 角色：擅长把命盘转成通俗解读的观察者；**只输出严格 JSON、无围栏外文字**。
  - **明确告知 AI：盘已算好，你只做解读，不要自己推算干支。**
  - 强约束：**任一字段无可靠依据填「暂无足够线索」，禁止臆测**；社交结论措辞软化，定位"提醒"。
  - 内嵌 JSON 模板，逐字段标注含义。
- **`parseAstroReading(text: string): AstroReading`**
  容错解析：剥围栏、定位首尾花括号、逐字段取非空字符串、`trim()` 存入，**永不抛异常**，垃圾输入返回 `{}`。完全沿用 `profile.ts` 模式。

```typescript
export interface AstroReading {
  personality?: string   // 性格解读(并入 MBTI 味道)
  fortune?: string       // 近期流月流日运势解读
  affinity?: string      // 与我的相性解读("运势是否对称")
  advice?: string        // 社交结论:"近期宜亲近/宜保持距离" + 一句依据
}
```

- 所有字段可选；`parseAstroReading` 只接受非空字符串。
- 解析层省略缺失字段，展示层对缺失字段渲染「暂无足够线索」。
- **持久化**：结果存本地 IndexedDB，刷新后直接展示（与好友画像的"不持久化"不同，时效规则见第 3 节约束与第 8.3 节存储）。

## 8. 页面 UI（miniapp）

### 8.1 「我的命盘」设置（前置）

合盘、流日相冲都要拿好友盘和「我」的盘比对，故「我」也需一张盘。

- 入口放「我的 / 设置」页：生辰表单（公历/农历切换、年月日、时辰可选、性别）。
- 存 IndexedDB `meta` 库新键 `myBazi`（存 `BirthInfo`，读时再 `buildBaziChart`；或缓存 chart）。
- 填一次长期有效，可修改。

### 8.2 好友详情页「☯ 命理运势」卡 —— 三种状态

1. **「我的命盘」未设置** → 卡片引导"先设置我的生辰"，跳设置页。
2. **好友生辰缺失** → 卡内嵌**补录表单**（公历/农历、年月日、时辰可选、性别）+ 一个「AI 从聊天抽取」按钮：抽到预填、抽不到手填；确认后存入该好友记录。
3. **两者齐全** → **有缓存则直接展示**（并按时效提示），否则点击生成，渲染完整卡：
   - **命盘速览**：四柱干支 / 生肖 / 星座 / 五行（确定性，不经 AI，秒出）。时辰缺失标注"未含时柱，结果偏粗"。
   - **性格**（AI）
   - **近期运势**：流月流日解读（AI）
   - **与我相性**：合盘六合/相冲 + 流日相冲**红色高亮**（"冲课"在这）（机械判定 + AI 解读）
   - **社交提示**：「近期宜亲近 / 宜保持距离」+ 一句依据（AI，措辞软化）
   - 底部**大免责**：「命理内容仅供娱乐参考」

- 沿用现有卡片 class 与配色变量（`--accent-wash` / `--muted` / `--fg` 等），不新造设计语言。
- 缺字段统一渲染「暂无足够线索」。

## 9. 隐私与边界

- **生辰是敏感个人信息**：用户主动填 / AI 抽取后经用户确认；只存本地 IndexedDB；**绝不上传聊天原文**。
- 发给 AI 的只有**算好的结构化盘**（干支/五行/合盘结果）+ 抽生辰时的**有界样本**（复用 `extractFriendSamples`），**不发聊天原文**，不破坏原文不落盘铁律。
- AI 抽生辰：从有界样本里找好友透露的生日/星座/属相，**抽不到就坦白"未找到"，禁止编造生辰**。
- 命理结论**仅供娱乐参考**：强免责；「宜保持距离」类建议**措辞软化**，定位"提个醒"而非"判决"，避免变成"AI 让你和某人绝交"。
- 授权前提：用户分析的是自己拥有的聊天记录 + 自己主动填的生辰，属正当的个人用途。

## 10. 测试（TDD）

**core `astrology/*.test.ts`（纯函数，最好测）：**
- `chart.ts`：给定生辰断言四柱干支、日主、五行分布、生肖、星座；缺时辰时 `pillars.hour` 省略、只出三柱。
- `fortune.ts`：断言某日干支与生克关系（生/克/比/泄/耗）。
- `compat.ts`：固定案例断言六合/相冲/相刑/相害（如子午相冲、寅亥六合）。

**core `ai/astro.test.ts`：**
- `buildAstroPrompt`：含盘数据关键字（四柱/五行/合盘）+「盘已算好、只做解读」约束 + 免责/软化约束 + 好友名。
- `parseAstroReading`：完整对象、剥围栏、缺字段省略、空串过滤、垃圾输入返回 `{}` 永不抛异常。

**miniapp `aiClient.test.ts`：**
- `analyzeAstro` 用 mock transport 返回结构化 JSON，断言解析出 4 段（personality/fortune/affinity/advice），且 prompt 含盘数据。

**构建：** core 改动后 `pnpm --filter @nianlun/core build`；页面无单测，靠 `build:mp-weixin` + 微信开发者工具手测。

## 11. 已知缺口 / 后续

- 第二版：首页「今日提醒」聚合。
- 塔罗记录归集：暂缓，待客户确认聊天里确有塔罗内容再评估。
- 时辰缺失时八字偏粗——UI 已提示，可后续加"仅按公历粗排"的降级说明。
