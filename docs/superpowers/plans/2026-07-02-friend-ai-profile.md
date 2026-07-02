# AI 好友画像（含金融投资偏好）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 好友详情页新增「✦ 好友画像」按钮，一次 AI 调用推断好友的 身份/家庭/感情/生活 + 投资偏好（风险/品类/财富/决策），渲染成画像卡。

**Architecture:** 完全沿用深度情绪那套。core 新增纯函数 `profile.ts`（prompt 构造 + 容错 parser）；miniapp 的 aiClient 加 `analyzeFriendProfile`；friend-detail 页加按钮 + 画像卡。严格 `miniapp → core` 单向依赖，结果不落盘。

**Tech Stack:** TypeScript、Vitest、Vue 3（uni-app mp-weixin）。

## Global Constraints

- 注释/文案用**中文**。
- `@nianlun/core` 是纯函数库：**不碰 DOM/window/网络/vue**；parser **容错、永不抛异常**（坏数据降级、垃圾输入返回 `{}`）。
- 依赖链严格 `miniapp → core`。改 core 后 miniapp 解析的是 **dist**，故 miniapp 任务前必须 `pnpm --filter @nianlun/core build`。
- **单次 AI 调用返回全部内容**；结果**不持久化**（刷新后归 null，需重新点击）。
- 只用**有界样本**（`samples.loadSamplesFor`），不改「聊天原文不落盘」铁律。
- 任一字段无可靠线索时值为「暂无足够线索」，**禁止臆测**；解析层省略缺失字段，展示层统一渲染「暂无足够线索」。
- 投资子块**常驻展示**（即使 core 省略了整个 `investment`），5 行固定：总述 / 风险 / 品类 / 财富 / 决策。
- 每个字段是一小段简述（约 30~60 字），不是单个标签词。
- 画像卡底部标注「AI 推测，仅供参考」。
- **Windows 上用 PowerShell 跑 build/test**（Git Bash 的 locale 会把产物中文写成 `?`）。
- mp-weixin 模板**不使用可选链 `?.`**，用 `a && a.b` 代替（与现有 friend-detail 一致）。

---

### Task 1: core — FriendProfile 类型 + buildFriendProfilePrompt

**Files:**
- Create: `packages/core/src/ai/profile.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/ai/__tests__/profile.test.ts`

**Interfaces:**
- Consumes: `Friend`（来自 `../model/types`）。
- Produces:
  - `interface InvestmentProfile { summary?: string; risk?: string; categories?: string; wealth?: string; style?: string }`
  - `interface FriendProfile { identity?: string; family?: string; romance?: string; lifestyle?: string; investment?: InvestmentProfile }`
  - `function buildFriendProfilePrompt(friend: Friend, samples: string[]): string`

- [ ] **Step 1: 写失败测试**

创建 `packages/core/src/ai/__tests__/profile.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import type { Friend } from '../../model/types'
import { buildFriendProfilePrompt } from '../profile'

const friend: Friend = {
  id: 'f1', name: '小美', alias: '', rel: '客户', role: '支行长',
  firstContact: 0, lastContact: 0, msgCount: 300, sentRatio: 55,
  peakPeriod: '晚上', maxStreak: 9, monthly: new Array(12).fill(0), userEdited: {},
  hourly: new Array(24).fill(0), weekHour: new Array(168).fill(0), keywords: [],
}

describe('buildFriendProfilePrompt', () => {
  it('含好友名、5 个侧面字段、投资 4 子维度与「暂无足够线索」约束', () => {
    const p = buildFriendProfilePrompt(friend, ['我：最近买基金了', '对方：稳健点好'])
    expect(p).toContain('小美')
    expect(p).toContain('identity')
    expect(p).toContain('family')
    expect(p).toContain('romance')
    expect(p).toContain('lifestyle')
    expect(p).toContain('investment')
    expect(p).toContain('risk')
    expect(p).toContain('categories')
    expect(p).toContain('wealth')
    expect(p).toContain('style')
    expect(p).toContain('暂无足够线索')
    expect(p).toContain('我：最近买基金了')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/profile.test.ts`
Expected: FAIL（`Cannot find module '../profile'` 或 `buildFriendProfilePrompt is not a function`）

- [ ] **Step 3: 写最小实现**

创建 `packages/core/src/ai/profile.ts`：

```typescript
import type { Friend } from '../model/types'

export interface InvestmentProfile {
  summary?: string   // 一小段总述
  risk?: string      // 风险偏好：保守/稳健/平衡/进取
  categories?: string // 关注品类：股票/基金/房产/保险/黄金/存款/加密
  wealth?: string    // 财富与可投线索
  style?: string     // 决策风格与周期：自主/听建议、长线/短线/投机
}

export interface FriendProfile {
  identity?: string  // 身份/职业
  family?: string    // 家庭状况
  romance?: string   // 感情状态
  lifestyle?: string // 生活方式
  investment?: InvestmentProfile
}

/**
 * 好友画像提示词：依据聚合统计 + 有界样本，要求 AI 输出严格 JSON。
 * 5 个侧面（身份/家庭/感情/生活/投资），每字段一小段简述；无线索填「暂无足够线索」。
 */
export function buildFriendProfilePrompt(friend: Friend, samples: string[]): string {
  const displayName = friend.alias || friend.name
  const sampleBlock = samples.length
    ? samples.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '（本次无可用聊天样本）'

  return [
    '你是一位擅长从聊天记录推断人物背景的观察者。请根据下面这位微信好友的往来统计与部分聊天样本，',
    '推断 TA 的多方面画像，供金融从业者了解客户之用。',
    '',
    '只输出一个严格的 JSON 对象，不要任何解释、不要代码围栏外的文字。格式：',
    '{',
    '  "identity": "<身份/职业：行业+头衔+单位类型，一小段简述>",',
    '  "family": "<家庭状况：婚否、子女、与家人互动，一小段简述>",',
    '  "romance": "<感情状态：单身/恋爱/已婚等，一小段简述>",',
    '  "lifestyle": "<生活方式：兴趣爱好、作息、常聊话题，一小段简述>",',
    '  "investment": {',
    '    "summary": "<投资偏好总述，一小段>",',
    '    "risk": "<风险偏好：保守/稳健/平衡/进取，附依据>",',
    '    "categories": "<关注品类：股票/基金/房产/保险/黄金/存款/加密等>",',
    '    "wealth": "<财富与可投线索：大致财富水平、是否有闲置资金>",',
    '    "style": "<决策风格与周期：自主/听建议、长线/短线/投机、当下是否有理财需求>"',
    '  }',
    '}',
    '',
    '要求：每个字段给一小段简述（约 30~60 字，可点出聊天里的依据），不要只给一个标签词。',
    '任一字段若样本中无可靠线索，值填「暂无足够线索」，禁止臆测（尤其感情、家庭、财富）。',
    '',
    '聚合统计：',
    `- 好友：${displayName}`,
    `- 关系标签：${friend.rel}`,
    `- 职务/备注：${friend.role || '（未填）'}`,
    `- 全年消息往来：${friend.msgCount} 条`,
    `- 我方发送占比：${friend.sentRatio}%`,
    `- 活跃时段：${friend.peakPeriod || '（无）'}`,
    '',
    '部分聊天样本（「我」为用户本人，「对方」为该好友）：',
    sampleBlock,
  ].join('\n')
}
```

在 `packages/core/src/index.ts` 追加（放在 sentiment 导出附近）：

```typescript
export { buildFriendProfilePrompt } from './ai/profile'
export type { FriendProfile, InvestmentProfile } from './ai/profile'
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/profile.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/ai/profile.ts packages/core/src/index.ts packages/core/src/ai/__tests__/profile.test.ts
git commit -m "feat(core): 好友画像 prompt（身份/家庭/感情/生活 + 投资偏好）"
```

---

### Task 2: core — parseFriendProfile 容错解析

**Files:**
- Modify: `packages/core/src/ai/profile.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/ai/__tests__/profile.test.ts`

**Interfaces:**
- Consumes: `FriendProfile`、`InvestmentProfile`（Task 1 定义）。
- Produces: `function parseFriendProfile(text: string): FriendProfile` —— 剥围栏、定位首尾花括号、逐字段取非空 trim 字符串；`investment` 内部全空则省略整块；垃圾输入返回 `{}`，永不抛异常。

- [ ] **Step 1: 写失败测试**

在 `profile.test.ts` 末尾追加（并把顶部 import 改为 `import { buildFriendProfilePrompt, parseFriendProfile } from '../profile'`）：

```typescript
describe('parseFriendProfile', () => {
  it('解析完整对象（含嵌套 investment）', () => {
    const r = parseFriendProfile(JSON.stringify({
      identity: '某城商行支行长', family: '已婚有一子', romance: '婚姻稳定',
      lifestyle: '爱打高尔夫、常聊出差', investment: {
        summary: '整体稳健偏保守', risk: '稳健型', categories: '基金、银行理财',
        wealth: '可投资金较充裕', style: '偏自主、长线为主',
      },
    }))
    expect(r.identity).toBe('某城商行支行长')
    expect(r.lifestyle).toBe('爱打高尔夫、常聊出差')
    expect(r.investment?.risk).toBe('稳健型')
    expect(r.investment?.style).toBe('偏自主、长线为主')
  })
  it('剥代码围栏后仍能解析', () => {
    const r = parseFriendProfile('```json\n{"identity":"中学老师"}\n```')
    expect(r.identity).toBe('中学老师')
  })
  it('缺字段时省略该字段', () => {
    const r = parseFriendProfile('{"identity":"程序员"}')
    expect(r.identity).toBe('程序员')
    expect(r.family).toBeUndefined()
    expect(r.investment).toBeUndefined()
  })
  it('investment 部分子字段缺失时只保留有值的', () => {
    const r = parseFriendProfile(JSON.stringify({ investment: { risk: '进取型', categories: '' } }))
    expect(r.investment).toEqual({ risk: '进取型' })
  })
  it('investment 全空时整块省略', () => {
    const r = parseFriendProfile(JSON.stringify({ investment: { risk: '', summary: '  ' } }))
    expect(r.investment).toBeUndefined()
  })
  it('空串字段被过滤', () => {
    const r = parseFriendProfile('{"identity":"  ","family":"有娃"}')
    expect(r.identity).toBeUndefined()
    expect(r.family).toBe('有娃')
  })
  it('垃圾输入 / 空串返回 {}，不抛异常', () => {
    expect(parseFriendProfile('不是 JSON')).toEqual({})
    expect(parseFriendProfile('')).toEqual({})
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/profile.test.ts`
Expected: FAIL（`parseFriendProfile is not a function`）

- [ ] **Step 3: 写最小实现**

在 `packages/core/src/ai/profile.ts` 末尾追加：

```typescript
/** 取非空 trim 字符串，否则 undefined。 */
function pickText(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}

/** 从任意值里挑出投资子对象；内部全无有效字段则返回 undefined。 */
function pickInvestment(v: unknown): InvestmentProfile | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const r = v as Record<string, unknown>
  const out: InvestmentProfile = {}
  const summary = pickText(r.summary); if (summary) out.summary = summary
  const risk = pickText(r.risk); if (risk) out.risk = risk
  const categories = pickText(r.categories); if (categories) out.categories = categories
  const wealth = pickText(r.wealth); if (wealth) out.wealth = wealth
  const style = pickText(r.style); if (style) out.style = style
  return Object.keys(out).length ? out : undefined
}

/**
 * 容错解析好友画像 JSON：剥围栏、定位首尾花括号、逐字段取非空字符串；
 * investment 内部全空则省略整块。无法解析返回 {}，永不抛异常。
 */
export function parseFriendProfile(text: string): FriendProfile {
  if (typeof text !== 'string') return {}
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return {}
  let obj: unknown
  try { obj = JSON.parse(text.slice(start, end + 1)) } catch { return {} }
  if (typeof obj !== 'object' || obj === null) return {}
  const r = obj as Record<string, unknown>
  const out: FriendProfile = {}
  const identity = pickText(r.identity); if (identity) out.identity = identity
  const family = pickText(r.family); if (family) out.family = family
  const romance = pickText(r.romance); if (romance) out.romance = romance
  const lifestyle = pickText(r.lifestyle); if (lifestyle) out.lifestyle = lifestyle
  const investment = pickInvestment(r.investment); if (investment) out.investment = investment
  return out
}
```

在 `packages/core/src/index.ts` 把 Task 1 那行改为同时导出 parser：

```typescript
export { buildFriendProfilePrompt, parseFriendProfile } from './ai/profile'
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/profile.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 构建 core（让 miniapp 能解析新 dist）**

Run（PowerShell）: `pnpm --filter @nianlun/core build`
Expected: 构建成功，`packages/core/dist/` 更新。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/ai/profile.ts packages/core/src/index.ts packages/core/src/ai/__tests__/profile.test.ts
git commit -m "feat(core): parseFriendProfile 容错解析好友画像"
```

---

### Task 3: miniapp — aiClient 新增 analyzeFriendProfile

**Files:**
- Modify: `packages/miniapp/src/adapters/aiClient.ts`
- Test: `packages/miniapp/src/adapters/__tests__/aiClient.test.ts`

**前置：** Task 2 已 `pnpm --filter @nianlun/core build`。

**Interfaces:**
- Consumes: `buildFriendProfilePrompt`、`parseFriendProfile`、`FriendProfile`（core 导出）；`Transport`（本文件已有）。
- Produces: `aiClient.analyzeFriendProfile(friend: Friend, samples: string[]): Promise<FriendProfile>`

- [ ] **Step 1: 写失败测试**

在 `packages/miniapp/src/adapters/__tests__/aiClient.test.ts` 的 `analyzeYearSentiment` 用例前追加：

```typescript
  it('analyzeFriendProfile 走画像 prompt 并解析 5 侧面 + 投资子维度', async () => {
    const transport = vi.fn().mockResolvedValue(JSON.stringify({
      identity: '某城商行支行长', family: '已婚有一子', romance: '婚姻稳定',
      lifestyle: '爱打高尔夫', investment: {
        summary: '整体稳健', risk: '稳健型', categories: '基金、理财',
        wealth: '资金充裕', style: '长线为主',
      },
    }))
    const out = await makeAiClient(transport).analyzeFriendProfile(FRIEND, ['我：最近买基金了', '对方：稳健点好'])
    expect(out.identity).toBe('某城商行支行长')
    expect(out.investment?.risk).toBe('稳健型')
    expect(out.investment?.style).toBe('长线为主')
    expect(transport.mock.calls[0][0]).toContain('investment')
    expect(transport.mock.calls[0][0]).toContain('张三')
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/aiClient.test.ts`
Expected: FAIL（`analyzeFriendProfile is not a function`）

- [ ] **Step 3: 写最小实现**

改 `packages/miniapp/src/adapters/aiClient.ts`：

顶部 import 增补 `buildFriendProfilePrompt, parseFriendProfile`，type import 增补 `FriendProfile`：

```typescript
import {
  buildReportCopyPrompt, buildFriendSuggestionPrompt, parseFriendSuggestion,
  buildYearSentimentPrompt, buildFriendDeepSentimentPrompt, parseDeepSentiment,
  buildFriendProfilePrompt, parseFriendProfile,
} from '@nianlun/core'
import type { Friend, ReportData, FriendSuggestion, DeepSentiment, FriendProfile } from '@nianlun/core'
```

在 `makeAiClient` 返回对象里、`analyzeFriendSentiment` 之后加：

```typescript
    async analyzeFriendProfile(friend: Friend, samples: string[]): Promise<FriendProfile> {
      const text = await transport(buildFriendProfilePrompt(friend, samples), 1024)
      return parseFriendProfile(text)
    },
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/aiClient.test.ts`
Expected: PASS（新用例 + 原有用例都过）

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/aiClient.ts packages/miniapp/src/adapters/__tests__/aiClient.test.ts
git commit -m "feat(miniapp): aiClient 新增 analyzeFriendProfile"
```

---

### Task 4: miniapp — friend-detail 好友画像按钮 + 画像卡

**Files:**
- Modify: `packages/miniapp/src/pages/friend-detail/friend-detail.vue`（script + template + style）

无单测（逻辑已在 Task 1–3 纯函数覆盖），以 PowerShell `build:mp-weixin` + 微信开发者工具手测验证。

**Interfaces:**
- Consumes: `aiClient.analyzeFriendProfile`（Task 3）、`FriendProfile`（core 导出）、`samples.loadSamplesFor`（本页已用）。

- [ ] **Step 1: script —— 类型 import + 状态 + 方法**

`friend-detail.vue` 顶部 type import 增补 `FriendProfile`：

```typescript
import type { Relation, DeepSentiment, FriendProfile } from '@nianlun/core'
```

在 `analyzeSentiment` 函数之后追加：

```typescript
const profile = ref<FriendProfile | null>(null)
const loadingProfile = ref(false)
async function analyzeProfile() {
  const f = friend.value
  if (!f) return
  const s = samples.loadSamplesFor(f.id)
  const ok = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: 'AI 好友画像',
      content: `将发送约 ${s.length} 条聊天片段到 AI 服务生成好友画像，是否继续？`,
      success: (r) => resolve(r.confirm),
    })
  })
  if (!ok) return
  loadingProfile.value = true
  try {
    const r = await aiClient.analyzeFriendProfile(f, s)
    profile.value = (r.identity || r.family || r.romance || r.lifestyle || r.investment)
      ? r
      : { identity: 'AI 无法生成画像' }
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loadingProfile.value = false
  }
}
```

- [ ] **Step 2: template —— 按钮**

在编辑卡 `.edit-row`（现有「✦ 情绪分析」那一行）末尾、`</view>` 前加一个按钮：

```html
        <text class="act act-ai" @click="analyzeProfile">{{ loadingProfile ? '生成中…' : '✦ 好友画像' }}</text>
```

- [ ] **Step 3: template —— 画像卡**

在编辑卡整块 `</view>`（含情绪 `.senti` 的那张 card）之后、聊天样本 card 之前，插入：

```html
      <view v-if="profile" class="card block">
        <text class="block-t">好友画像</text>
        <view class="prof">
          <view class="prof-row"><text class="prof-k">身份/职业</text><text class="prof-v">{{ profile.identity || '暂无足够线索' }}</text></view>
          <view class="prof-row"><text class="prof-k">家庭状况</text><text class="prof-v">{{ profile.family || '暂无足够线索' }}</text></view>
          <view class="prof-row"><text class="prof-k">感情状态</text><text class="prof-v">{{ profile.romance || '暂无足够线索' }}</text></view>
          <view class="prof-row"><text class="prof-k">生活方式</text><text class="prof-v">{{ profile.lifestyle || '暂无足够线索' }}</text></view>
        </view>
        <view class="prof-inv">
          <text class="prof-inv-t">投资偏好</text>
          <text class="prof-inv-sum">{{ (profile.investment && profile.investment.summary) || '暂无足够线索' }}</text>
          <view class="prof-row"><text class="prof-k">风险偏好</text><text class="prof-v">{{ (profile.investment && profile.investment.risk) || '暂无足够线索' }}</text></view>
          <view class="prof-row"><text class="prof-k">关注品类</text><text class="prof-v">{{ (profile.investment && profile.investment.categories) || '暂无足够线索' }}</text></view>
          <view class="prof-row"><text class="prof-k">财富线索</text><text class="prof-v">{{ (profile.investment && profile.investment.wealth) || '暂无足够线索' }}</text></view>
          <view class="prof-row"><text class="prof-k">决策风格</text><text class="prof-v">{{ (profile.investment && profile.investment.style) || '暂无足够线索' }}</text></view>
        </view>
        <text class="senti-note faint">AI 推测，仅供参考</text>
      </view>
```

- [ ] **Step 4: style —— 追加画像卡样式**

在 `.senti-note` 规则之后追加：

```css
.prof { margin-top: 20rpx; }
.prof-row { display: flex; padding: 14rpx 0; border-top: 1rpx solid var(--border); }
.prof-k { flex: none; width: 140rpx; font-size: 24rpx; color: var(--muted); }
.prof-v { flex: 1; font-size: 25rpx; color: var(--fg); line-height: 1.6; }
.prof-inv { margin-top: 24rpx; padding: 24rpx; background: var(--accent-wash); border-radius: 16rpx; }
.prof-inv-t { display: block; font-size: 26rpx; font-weight: 600; color: var(--accent-strong); }
.prof-inv-sum { display: block; margin: 12rpx 0 4rpx; font-size: 25rpx; color: var(--fg); line-height: 1.7; }
```

（`.prof-inv` 内部的 `.prof-row` 复用上面规则；投资块内首行 `.prof-row` 的上边框在浅色底上可接受，无需特判。）

- [ ] **Step 5: 构建并手测**

Run（PowerShell）: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: 编译通过。

用微信开发者工具导入 `packages/miniapp/dist/build/mp-weixin`，进入某好友详情页，点「✦ 好友画像」→ 弹确认框 → 确认后渲染画像卡：前 4 侧面各一段、投资块 5 行、无线索处显示「暂无足够线索」、底部「AI 推测，仅供参考」。

- [ ] **Step 6: 提交**

```bash
git add packages/miniapp/src/pages/friend-detail/friend-detail.vue
git commit -m "feat(miniapp): 好友详情页 AI 好友画像卡（含投资偏好）"
```

---

## 边界与说明

- **不持久化**：刷新后 `profile` 归 null，需重新点按钮（与情绪分析一致）。
- **投资子块常驻**：即便 core 省略了整个 `investment`，5 行仍显示，缺失行为「暂无足够线索」。
- **敏感侧面**（感情/家庭/财富）靠 prompt「无线索即坦白」兜底，宁缺毋编。
- **mp-weixin 模板不用 `?.`**：投资字段访问统一写 `profile.investment && profile.investment.xxx`。
- **零回归**：不改动现有情绪分析 / 关系建议 / 任何 core 既有函数，纯新增。
