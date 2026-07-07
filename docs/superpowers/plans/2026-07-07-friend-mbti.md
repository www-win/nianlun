# 好友 MBTI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每个微信好友增加 MBTI 能力——优先从昵称/备注识别类型码，识别不到可点按钮用 AI 分析聊天样本得出，允许手动改；深度为「类型标签 + 四维倾向 + 一段解读」。

**Architecture:** MBTI = 又一个「好友级 AI 结果」（与情绪/画像同构），外加一个走 `Friend.userEdited` + 备注正则的离线覆盖层。core 提供纯函数（识别/提示词/解析/有效值计算），miniapp 复用现有 AI 结果持久化通道（`saveFriendEntry`/`loadFriendEntry` + `msgCount:lastContact` 指纹）与行内编辑管线。

**Tech Stack:** TypeScript（core 纯函数，`lib:["ES2020"]` 无 DOM）、Vitest、Vue 3 + uni-app（miniapp）、Pinia。

## Global Constraints

- 严格单向依赖 `miniapp → core`；`core` 不得触碰 `window`/`document`/`wx`/`vue`/DOM（编译期 `types:[]` 强制）。
- core 解析/识别函数**永不抛异常**，坏输入返回 `null`。
- 页面从 store/adapters 读数据，编辑经 `data.updateFriend`，绝不直接改 store 数据或直接调用 core 计算。
- 手动编辑写入 `Friend.userEdited`，靠 `mergeFriends` 的「userEdited 优先」在重新导入时保留。
- 不新增存储机制：好友级 AI 结果复用 `storage` 现有通道；持久化前对 Pinia 响应式对象 `JSON.parse(JSON.stringify(...))` 去代理。
- 16 型码大写规范：`INTJ INTP ENTJ ENTP INFJ INFP ENFJ ENFP ISTJ ISFJ ESTJ ESFJ ISTP ISFP ESTP ESFP`。
- 正则识别不使用 lookbehind（miniapp 旧机兼容），用 `(^|[^a-z])...([^a-z]|$)` 边界。
- 命令用 pnpm；core 测试 `pnpm --filter @nianlun/core exec vitest run <file>`，miniapp 测试 `pnpm --filter @nianlun/miniapp exec vitest run <file>`。

---

## 文件结构

- `packages/core/src/model/types.ts`（改）：新增 `MbtiCode` 类型；`Friend.userEdited` 加 `mbti?: MbtiCode`。
- `packages/core/src/ai/mbti.ts`（新）：`MbtiAxis`/`MbtiDimension`/`MbtiResult`/`MbtiSource` 类型、`MBTI_CODES`/`MBTI_TITLES` 常量、`mbtiTitle`/`detectMbtiFromText`/`buildMbtiPrompt`/`parseMbti`/`effectiveMbtiCode`。
- `packages/core/src/index.ts`（改）：导出上述类型与函数、`MbtiCode`。
- `packages/core/src/ai/__tests__/mbti.test.ts`（新）：core 单测。
- `packages/core/src/merge/__tests__/merge.test.ts`（改）：新增 `userEdited.mbti` 保留用例。
- `packages/miniapp/src/adapters/aiClient.ts`（改）：`analyzeFriendMbti`。
- `packages/miniapp/src/adapters/storage.ts`（改）：`K_FRIEND_MBTI` + `saveFriendMbti`/`loadFriendMbti` + `clearAll`。
- `packages/miniapp/src/adapters/__tests__/storage.test.ts`（改/新用例）：MBTI 往返/指纹/清空。
- `packages/miniapp/src/stores/data.ts`（改）：`updateFriend` 支持 `mbti`。
- `packages/miniapp/src/stores/__tests__/data.test.ts`（改/新用例）：`updateFriend` mbti 设置/清除。
- `packages/miniapp/src/pages/friend-detail/friend-detail.vue`（改）：MBTI 卡片。
- `packages/miniapp/src/pages/friends/friends.vue`（改）：列表徽标。

---

## Task 1: core 模型加 MbtiCode 与 userEdited.mbti（含 merge 保留）

**Files:**
- Modify: `packages/core/src/model/types.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/merge/__tests__/merge.test.ts`

**Interfaces:**
- Produces: `type MbtiCode`（16 型字面量联合）；`Friend.userEdited.mbti?: MbtiCode`。后续 core/miniapp 全部依赖此类型定义与该字段。

- [ ] **Step 1: 在 model/types.ts 加 MbtiCode 类型**

在 `Relation` 定义下方新增：

```ts
export type MbtiCode =
  | 'INTJ' | 'INTP' | 'ENTJ' | 'ENTP'
  | 'INFJ' | 'INFP' | 'ENFJ' | 'ENFP'
  | 'ISTJ' | 'ISFJ' | 'ESTJ' | 'ESFJ'
  | 'ISTP' | 'ISFP' | 'ESTP' | 'ESFP'
```

- [ ] **Step 2: 给 Friend.userEdited 加 mbti 槽**

把 `Friend` 的 `userEdited` 行改为：

```ts
  userEdited: { role?: string; rel?: Relation; alias?: string; name?: string; mbti?: MbtiCode }
```

- [ ] **Step 3: index.ts 导出 MbtiCode**

把 `packages/core/src/index.ts` 第 3–6 行的 model 类型导出块里的 `Relation,` 后补上 `MbtiCode,`：

```ts
export type {
  Message, Conversation, Friend, ReportData, Relation, MbtiCode,
  ...（保持该块原有其余项不变）
} from './model/types'
```

- [ ] **Step 4: 写失败测试——mergeFriends 保留 userEdited.mbti**

在 `packages/core/src/merge/__tests__/merge.test.ts` 末尾追加（沿用文件已有的构造好友辅助方式；若文件用 `createFriend`，则照此写）：

```ts
import { MBTI_CODES } from '../../ai/mbti' // 若 mbti.ts 尚未建，本用例先跳过 import，改为字面量 'INTJ'

it('mergeFriends 保留用户手改的 userEdited.mbti，不被重新导入覆盖', () => {
  const old = createFriend('u1', '老王')
  old.userEdited.mbti = 'INTJ'
  const inc = createFriend('u1', '老王') // 重新导入，无 mbti
  const [merged] = mergeFriends([old], [inc])
  expect(merged.userEdited.mbti).toBe('INTJ')
})
```

> 注意：`merge/merge.ts` 现有 `merged.userEdited = { ...inc.userEdited, ...old.userEdited }` 已经通过展开保留了 `mbti`，本任务**不改 merge.ts**，测试用于锁定该行为。若 `createFriend`/`mergeFriends` 的导入路径与本文件既有用例不同，照既有用例的写法对齐。

- [ ] **Step 5: 运行测试确认通过（行为已被现有展开覆盖）**

Run: `pnpm --filter @nianlun/core exec vitest run src/merge/__tests__/merge.test.ts`
Expected: 全绿，含新用例 PASS。

> 若新用例意外失败，说明 merge.ts 未展开保留 mbti，此时才需在 `mergeFriends` 补 `merged.userEdited` 的处理——但预期不需要。

- [ ] **Step 6: 类型检查**

Run: `pnpm --filter @nianlun/core build`
Expected: tsup 构建成功，无类型错误。

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/model/types.ts packages/core/src/index.ts packages/core/src/merge/__tests__/merge.test.ts
git commit -m "feat(core): Friend.userEdited 增加 mbti 槽与 MbtiCode 类型"
```

---

## Task 2: core ai/mbti.ts —— 常量、mbtiTitle、detectMbtiFromText

**Files:**
- Create: `packages/core/src/ai/mbti.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/ai/__tests__/mbti.test.ts`

**Interfaces:**
- Consumes: `MbtiCode`（Task 1，from `../model/types`）。
- Produces:
  - `const MBTI_CODES: readonly MbtiCode[]`
  - `const MBTI_TITLES: Record<MbtiCode, string>`
  - `function mbtiTitle(code: MbtiCode): string`
  - `function detectMbtiFromText(text: string): MbtiCode | null`

- [ ] **Step 1: 写失败测试**

创建 `packages/core/src/ai/__tests__/mbti.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { MBTI_CODES, mbtiTitle, detectMbtiFromText } from '../mbti'

describe('MBTI 常量与识别', () => {
  it('MBTI_CODES 恰好 16 型且全大写', () => {
    expect(MBTI_CODES).toHaveLength(16)
    expect(new Set(MBTI_CODES).size).toBe(16)
    expect(MBTI_CODES.every((c) => c === c.toUpperCase())).toBe(true)
  })

  it('mbtiTitle 每型都有非空中文别名', () => {
    for (const c of MBTI_CODES) expect(mbtiTitle(c).length).toBeGreaterThan(0)
  })

  it('detectMbtiFromText 从备注文本识别类型码（大小写不敏感，返回大写）', () => {
    expect(detectMbtiFromText('老王 intj 客户')).toBe('INTJ')
    expect(detectMbtiFromText('我是ENFP型的')).toBe('ENFP')
    expect(detectMbtiFromText('(ISTP)')).toBe('ISTP')
  })

  it('detectMbtiFromText 词边界：紧贴字母不误匹配', () => {
    expect(detectMbtiFromText('aINTJ')).toBeNull()
    expect(detectMbtiFromText('INTJX')).toBeNull()
    expect(detectMbtiFromText('POINTJUMP')).toBeNull()
  })

  it('detectMbtiFromText 非 16 型串返回 null', () => {
    expect(detectMbtiFromText('INTX')).toBeNull()
    expect(detectMbtiFromText('老王')).toBeNull()
    expect(detectMbtiFromText('')).toBeNull()
  })

  it('detectMbtiFromText 非字符串安全返回 null', () => {
    // @ts-expect-error 故意传非字符串
    expect(detectMbtiFromText(null)).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/mbti.test.ts`
Expected: FAIL —— 找不到模块 `../mbti`。

- [ ] **Step 3: 实现常量与识别函数**

创建 `packages/core/src/ai/mbti.ts`：

```ts
import type { MbtiCode } from '../model/types'

export const MBTI_CODES: readonly MbtiCode[] = [
  'INTJ', 'INTP', 'ENTJ', 'ENTP',
  'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ',
  'ISTP', 'ISFP', 'ESTP', 'ESFP',
]

export const MBTI_TITLES: Record<MbtiCode, string> = {
  INTJ: '建筑师', INTP: '逻辑学家', ENTJ: '指挥官', ENTP: '辩论家',
  INFJ: '提倡者', INFP: '调停者', ENFJ: '主人公', ENFP: '竞选者',
  ISTJ: '物流师', ISFJ: '守卫者', ESTJ: '总经理', ESFJ: '执政官',
  ISTP: '鉴赏家', ISFP: '探险家', ESTP: '企业家', ESFP: '表演者',
}

export function mbtiTitle(code: MbtiCode): string {
  return MBTI_TITLES[code] ?? ''
}

// 边界不用 lookbehind（miniapp 旧机兼容）：前后须为串首尾或非字母。
// i 标志下 [^a-z] 已折叠大小写，等价「非字母」。
const CODE_RE = new RegExp(`(^|[^a-z])(${MBTI_CODES.join('|')})([^a-z]|$)`, 'i')

/** 从任意文本（昵称/备注/职务）识别首个 16 型码，返回大写规范码；无则 null。永不抛异常。 */
export function detectMbtiFromText(text: string): MbtiCode | null {
  if (typeof text !== 'string' || text === '') return null
  const m = CODE_RE.exec(text)
  if (!m) return null
  const code = m[2].toUpperCase() as MbtiCode
  return MBTI_CODES.includes(code) ? code : null
}
```

- [ ] **Step 4: index.ts 导出**

在 `packages/core/src/index.ts` 的 `./ai/profile` 导出行下方新增：

```ts
export { MBTI_CODES, MBTI_TITLES, mbtiTitle, detectMbtiFromText } from './ai/mbti'
export type { MbtiAxis, MbtiDimension, MbtiResult, MbtiSource } from './ai/mbti'
```

> `MbtiAxis/MbtiDimension/MbtiResult/MbtiSource` 类型在 Task 3 才实现；本步先只导出**已存在**的四个值 + `mbtiTitle`。类型导出行等 Task 3 建好类型后再加也可，但一次写好可避免遗漏——若此刻类型不存在会编译报错，则本步先只写 `export { MBTI_CODES, MBTI_TITLES, mbtiTitle, detectMbtiFromText } from './ai/mbti'`，类型导出行留到 Task 3 Step 5。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/mbti.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ai/mbti.ts packages/core/src/index.ts packages/core/src/ai/__tests__/mbti.test.ts
git commit -m "feat(core): MBTI 常量/别名/备注识别 detectMbtiFromText"
```

---

## Task 3: core ai/mbti.ts —— 类型、buildMbtiPrompt、parseMbti、effectiveMbtiCode

**Files:**
- Modify: `packages/core/src/ai/mbti.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/ai/__tests__/mbti.test.ts`

**Interfaces:**
- Consumes: `MbtiCode`（`../model/types`）、`Friend`（`../model/types`）、`MBTI_CODES`/`mbtiTitle`/`detectMbtiFromText`（Task 2）。
- Produces:
  - `type MbtiAxis = 'EI' | 'SN' | 'TF' | 'JP'`
  - `interface MbtiDimension { axis: MbtiAxis; pole: string; strength: number; note?: string }`
  - `interface MbtiResult { code: MbtiCode; title: string; summary: string; dimensions: MbtiDimension[] }`
  - `type MbtiSource = 'manual' | 'remark' | 'ai' | 'none'`
  - `function buildMbtiPrompt(friend: Friend, samples: string[]): string`
  - `function parseMbti(text: string): MbtiResult | null`
  - `function effectiveMbtiCode(friend: Friend, aiCode?: MbtiCode | null): { code: MbtiCode | null; source: MbtiSource }`

- [ ] **Step 1: 写失败测试**

在 `packages/core/src/ai/__tests__/mbti.test.ts` 追加：

```ts
import { buildMbtiPrompt, parseMbti, effectiveMbtiCode } from '../mbti'
import type { Friend } from '../../model/types'

function fakeFriend(over: Partial<Friend> = {}): Friend {
  return {
    id: 'u1', name: '老王', alias: '', rel: '客户', role: '',
    firstContact: 0, lastContact: 0, msgCount: 100, sentRatio: 50,
    peakPeriod: '晚上', maxStreak: 3, monthly: new Array(12).fill(0),
    hourly: new Array(24).fill(0), weekHour: new Array(168).fill(0),
    keywords: [], userEdited: {},
    ...over,
  }
}

describe('buildMbtiPrompt', () => {
  it('含好友名、关系与 JSON 契约要点', () => {
    const p = buildMbtiPrompt(fakeFriend({ alias: '王工' }), ['我：在吗', '对方：在'])
    expect(p).toContain('王工')
    expect(p).toContain('客户')
    expect(p).toContain('code')
    expect(p).toContain('dimensions')
    expect(p).toContain('我：在吗')
  })
  it('无样本时给占位而非崩溃', () => {
    expect(buildMbtiPrompt(fakeFriend(), [])).toContain('无可用聊天样本')
  })
})

describe('parseMbti', () => {
  it('解析完整 JSON（含代码围栏）', () => {
    const text = '```json\n{"code":"INTJ","title":"建筑师","summary":"理性独立。","dimensions":[' +
      '{"axis":"EI","pole":"I","strength":70,"note":"少主动"},' +
      '{"axis":"SN","pole":"N","strength":65},' +
      '{"axis":"TF","pole":"T","strength":80},' +
      '{"axis":"JP","pole":"J","strength":60}]}\n```'
    const r = parseMbti(text)!
    expect(r.code).toBe('INTJ')
    expect(r.title).toBe('建筑师')
    expect(r.dimensions).toHaveLength(4)
    expect(r.dimensions.map((d) => d.axis)).toEqual(['EI', 'SN', 'TF', 'JP'])
    expect(r.dimensions[0]).toMatchObject({ pole: 'I', strength: 70, note: '少主动' })
  })

  it('title 缺失用别名补，dimensions 缺失按 code 反推补齐', () => {
    const r = parseMbti('{"code":"enfp","summary":"热情。"}')!
    expect(r.code).toBe('ENFP')
    expect(r.title).toBe('竞选者')
    expect(r.dimensions.map((d) => d.pole)).toEqual(['E', 'N', 'F', 'P'])
    expect(r.dimensions.every((d) => d.strength >= 0 && d.strength <= 100)).toBe(true)
  })

  it('非法/缺失 code 返回 null', () => {
    expect(parseMbti('{"code":"INTX","summary":"x"}')).toBeNull()
    expect(parseMbti('{"summary":"无 code"}')).toBeNull()
  })

  it('脏文本/无花括号返回 null', () => {
    expect(parseMbti('这不是 JSON')).toBeNull()
    expect(parseMbti('')).toBeNull()
  })
})

describe('effectiveMbtiCode 优先级', () => {
  it('手改优先', () => {
    const f = fakeFriend({ alias: 'ENFP', userEdited: { mbti: 'INTJ' } })
    expect(effectiveMbtiCode(f, 'ISTP')).toEqual({ code: 'INTJ', source: 'manual' })
  })
  it('无手改则备注识别（alias > role > name）', () => {
    const f = fakeFriend({ alias: '王工 ENFP' })
    expect(effectiveMbtiCode(f, 'ISTP')).toEqual({ code: 'ENFP', source: 'remark' })
  })
  it('无手改无备注则用 AI 码', () => {
    expect(effectiveMbtiCode(fakeFriend(), 'ISTP')).toEqual({ code: 'ISTP', source: 'ai' })
  })
  it('全无则 none', () => {
    expect(effectiveMbtiCode(fakeFriend(), null)).toEqual({ code: null, source: 'none' })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/mbti.test.ts`
Expected: FAIL —— `buildMbtiPrompt`/`parseMbti`/`effectiveMbtiCode` 未定义。

- [ ] **Step 3: 实现类型与三个函数**

在 `packages/core/src/ai/mbti.ts` 顶部 import 改为，并在文件末尾追加实现：

```ts
import type { Friend, MbtiCode } from '../model/types'
```

追加：

```ts
export type MbtiAxis = 'EI' | 'SN' | 'TF' | 'JP'
export interface MbtiDimension {
  axis: MbtiAxis
  pole: string
  strength: number
  note?: string
}
export interface MbtiResult {
  code: MbtiCode
  title: string
  summary: string
  dimensions: MbtiDimension[]
}
export type MbtiSource = 'manual' | 'remark' | 'ai' | 'none'

const AXES: MbtiAxis[] = ['EI', 'SN', 'TF', 'JP']

/** MBTI 提示词：喂聚合统计 + 有界样本，要求 AI 输出严格 JSON。参照 buildFriendProfilePrompt。 */
export function buildMbtiPrompt(friend: Friend, samples: string[]): string {
  const displayName = friend.alias || friend.name
  const sampleBlock = samples.length
    ? samples.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '（本次无可用聊天样本）'
  return [
    '你是一位擅长从聊天记录推断人格类型（MBTI）的观察者。请根据这位微信好友的往来统计与部分聊天样本，',
    '推断 TA 的 MBTI 16 型人格。',
    '',
    '只输出一个严格的 JSON 对象，不要任何解释、不要代码围栏外的文字。格式：',
    '{',
    '  "code": "<四字母类型码，如 INTJ>",',
    '  "title": "<该类型中文别名，如 建筑师>",',
    '  "summary": "<一段人格解读，约 60~100 字，点出聊天里的依据>",',
    '  "dimensions": [',
    '    {"axis":"EI","pole":"<E 或 I>","strength":<0-100 偏向该极强度>,"note":"<一句依据>"},',
    '    {"axis":"SN","pole":"<S 或 N>","strength":<0-100>,"note":"<一句依据>"},',
    '    {"axis":"TF","pole":"<T 或 F>","strength":<0-100>,"note":"<一句依据>"},',
    '    {"axis":"JP","pole":"<J 或 P>","strength":<0-100>,"note":"<一句依据>"}',
    '  ]',
    '}',
    '',
    '要求：code 必须是 16 个合法类型之一，四个维度落点须与 code 一致。线索不足时给保守判断并在 note 里说明依据薄弱，禁止编造具体事件。',
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

function normalizeDimensions(raw: unknown, code: MbtiCode): MbtiDimension[] {
  const provided = Array.isArray(raw) ? raw : []
  return AXES.map((axis, i) => {
    const pole = code[i] // code 为真相来源，忽略 AI 给的 pole，避免矛盾
    const found = provided.find(
      (d) => typeof d === 'object' && d !== null && (d as { axis?: unknown }).axis === axis,
    ) as { strength?: unknown; note?: unknown } | undefined
    let strength = 60
    if (found && typeof found.strength === 'number' && found.strength >= 0 && found.strength <= 100) {
      strength = Math.round(found.strength)
    }
    const dim: MbtiDimension = { axis, pole, strength }
    if (found && typeof found.note === 'string' && found.note.trim()) dim.note = found.note.trim()
    return dim
  })
}

/** 容错解析 MBTI JSON：剥围栏、定花括号、校验 code；缺字段补齐。无法解析返回 null，永不抛异常。 */
export function parseMbti(text: string): MbtiResult | null {
  if (typeof text !== 'string') return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  let obj: unknown
  try { obj = JSON.parse(text.slice(start, end + 1)) } catch { return null }
  if (typeof obj !== 'object' || obj === null) return null
  const r = obj as Record<string, unknown>
  const rawCode = typeof r.code === 'string' ? r.code.trim().toUpperCase() : ''
  if (!MBTI_CODES.includes(rawCode as MbtiCode)) return null
  const code = rawCode as MbtiCode
  const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : mbtiTitle(code)
  const summary = typeof r.summary === 'string' && r.summary.trim() ? r.summary.trim() : ''
  return { code, title, summary, dimensions: normalizeDimensions(r.dimensions, code) }
}

/** 计算好友的有效 MBTI 码与来源：手改 > 备注识别(alias>role>name) > AI 码 > 无。 */
export function effectiveMbtiCode(
  friend: Friend,
  aiCode?: MbtiCode | null,
): { code: MbtiCode | null; source: MbtiSource } {
  const manual = friend.userEdited?.mbti
  if (manual && MBTI_CODES.includes(manual)) return { code: manual, source: 'manual' }
  const fromText =
    detectMbtiFromText(friend.alias || '') ||
    detectMbtiFromText(friend.role || '') ||
    detectMbtiFromText(friend.name || '')
  if (fromText) return { code: fromText, source: 'remark' }
  if (aiCode && MBTI_CODES.includes(aiCode)) return { code: aiCode, source: 'ai' }
  return { code: null, source: 'none' }
}
```

> Task 2 的 `import type { MbtiCode } from '../model/types'` 被本步替换为同时 import `Friend`。

- [ ] **Step 4: index.ts 补类型与函数导出**

在 `packages/core/src/index.ts` Task 2 加的 mbti 值导出行改/补为：

```ts
export {
  MBTI_CODES, MBTI_TITLES, mbtiTitle, detectMbtiFromText,
  buildMbtiPrompt, parseMbti, effectiveMbtiCode,
} from './ai/mbti'
export type { MbtiAxis, MbtiDimension, MbtiResult, MbtiSource } from './ai/mbti'
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/mbti.test.ts`
Expected: 全部 PASS。

- [ ] **Step 6: core 全量测试 + 构建**

Run: `pnpm --filter @nianlun/core test && pnpm --filter @nianlun/core build`
Expected: 全绿、构建成功（miniapp 依赖 core 的 dist）。

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/ai/mbti.ts packages/core/src/index.ts packages/core/src/ai/__tests__/mbti.test.ts
git commit -m "feat(core): MBTI 提示词/解析/有效值计算 buildMbtiPrompt+parseMbti+effectiveMbtiCode"
```

---

## Task 4: miniapp aiClient.analyzeFriendMbti + storage 持久化

**Files:**
- Modify: `packages/miniapp/src/adapters/aiClient.ts`
- Modify: `packages/miniapp/src/adapters/storage.ts`
- Test: `packages/miniapp/src/adapters/__tests__/storage.test.ts`

**Interfaces:**
- Consumes: `buildMbtiPrompt`/`parseMbti`（core）、`MbtiResult`（core）、现有 `saveFriendEntry`/`loadFriendEntry`（storage.ts 内部）。
- Produces:
  - `aiClient.analyzeFriendMbti(friend: Friend, samples: string[]): Promise<MbtiResult | null>`
  - `storage.saveFriendMbti(id: string, friend: Friend, data: MbtiResult): void`
  - `storage.loadFriendMbti(id: string, friend: Friend): { data: MbtiResult; stale: boolean } | null`

- [ ] **Step 1: 写失败测试——storage MBTI 往返/指纹/清空**

在 `packages/miniapp/src/adapters/__tests__/storage.test.ts` 追加（沿用该文件已有的内存 backend 构造方式与好友构造辅助；下方 `makeMemBackend`/`fakeFriend` 若文件已有等价物则复用之）：

```ts
import type { MbtiResult } from '@nianlun/core'

it('saveFriendMbti/loadFriendMbti 往返，指纹随 msgCount 失效，clearAll 清除', () => {
  const s = makeStorage(makeMemBackend()) // 与文件既有测试相同的构造方式
  const f = fakeFriend({ id: 'u1', msgCount: 100, lastContact: 5 })
  const data: MbtiResult = {
    code: 'INTJ', title: '建筑师', summary: 's',
    dimensions: [
      { axis: 'EI', pole: 'I', strength: 70 },
      { axis: 'SN', pole: 'N', strength: 60 },
      { axis: 'TF', pole: 'T', strength: 80 },
      { axis: 'JP', pole: 'J', strength: 55 },
    ],
  }
  s.saveFriendMbti('u1', f, data)

  const fresh = s.loadFriendMbti('u1', f)
  expect(fresh).not.toBeNull()
  expect(fresh!.data.code).toBe('INTJ')
  expect(fresh!.stale).toBe(false)

  const changed = { ...f, msgCount: 200 } // 输入变→指纹变→stale
  expect(s.loadFriendMbti('u1', changed)!.stale).toBe(true)

  s.clearAll()
  expect(s.loadFriendMbti('u1', f)).toBeNull()
})
```

> 若 `storage.test.ts` 现有的辅助命名不同（如 `mem()`、`mkFriend()`），照文件既有写法对齐；关键断言不变。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/storage.test.ts`
Expected: FAIL —— `saveFriendMbti` 不存在。

- [ ] **Step 3: storage.ts 加 MBTI 通道**

- 顶部类型 import 补 `MbtiResult`：把第 1 行 `import type { Friend, ReportData, BirthInfo, BaziChart, AstroReading, StockPick, Sentiment, FriendProfile } from '@nianlun/core'` 结尾的 `FriendProfile }` 改为 `FriendProfile, MbtiResult }`。
- 在键常量区（`K_FRIEND_PROFILE` 附近）新增：

```ts
const K_FRIEND_MBTI = 'nianlun:friendMbti'
```

- 在 `saveFriendProfile`/`loadFriendProfile` 之后新增：

```ts
    saveFriendMbti(id: string, friend: Friend, data: MbtiResult): void {
      saveFriendEntry(K_FRIEND_MBTI, id, friend, data)
    },
    loadFriendMbti(id: string, friend: Friend): { data: MbtiResult; stale: boolean } | null {
      return loadFriendEntry<MbtiResult>(K_FRIEND_MBTI, id, friend)
    },
```

- 在 `clearAll()` 里补一行移除：把 `backend.remove(K_FRIEND_SENTIMENT); backend.remove(K_FRIEND_PROFILE)` 改为 `backend.remove(K_FRIEND_SENTIMENT); backend.remove(K_FRIEND_PROFILE); backend.remove(K_FRIEND_MBTI)`。

- [ ] **Step 4: 运行 storage 测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/storage.test.ts`
Expected: PASS。

- [ ] **Step 5: aiClient.ts 加 analyzeFriendMbti**

- 顶部 core 值 import 块补 `buildMbtiPrompt, parseMbti,`：在 `buildFriendProfilePrompt, parseFriendProfile,` 行下方新增一行 `  buildMbtiPrompt, parseMbti,`。
- 类型 import 块补 `MbtiResult`：在 `Friend, ReportData, FriendSuggestion, Sentiment, FriendProfile,` 行的 `FriendProfile,` 后加 `MbtiResult,`（或另起一行）。
- 在 `analyzeFriendProfile` 方法之后新增：

```ts
    async analyzeFriendMbti(friend: Friend, samples: string[]): Promise<MbtiResult | null> {
      const text = await transport(buildMbtiPrompt(friend, samples), 768)
      return parseMbti(text)
    },
```

- [ ] **Step 6: 写并运行 aiClient MBTI 测试**

在 aiClient 既有测试文件（如 `packages/miniapp/src/adapters/__tests__/aiClient.test.ts`，若存在）追加；若无该文件则新建，沿用其它 aiClient 测试的 fake transport 写法：

```ts
it('analyzeFriendMbti：transport 返回 JSON → MbtiResult；脏输出 → null', async () => {
  const good = makeAiClient(async () => '{"code":"INTJ","summary":"理性。"}')
  const r = await good.analyzeFriendMbti(fakeFriend(), ['我：hi'])
  expect(r?.code).toBe('INTJ')

  const bad = makeAiClient(async () => '不是 JSON')
  expect(await bad.analyzeFriendMbti(fakeFriend(), [])).toBeNull()
})
```

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/aiClient.test.ts`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/miniapp/src/adapters/aiClient.ts packages/miniapp/src/adapters/storage.ts packages/miniapp/src/adapters/__tests__/
git commit -m "feat(miniapp): MBTI AI 客户端与好友级持久化(指纹+clearAll)"
```

---

## Task 5: data store updateFriend 支持 mbti + 好友详情页 MBTI 卡片

**Files:**
- Modify: `packages/miniapp/src/stores/data.ts`
- Modify: `packages/miniapp/src/pages/friend-detail/friend-detail.vue`
- Test: `packages/miniapp/src/stores/__tests__/data.test.ts`

**Interfaces:**
- Consumes: `effectiveMbtiCode`/`mbtiTitle`/`MBTI_CODES`/`MbtiResult`/`MbtiCode`（core）、`aiClient.analyzeFriendMbti`、`storage.saveFriendMbti`/`loadFriendMbti`（Task 4）、`samples.loadSamplesFor`（现有）。
- Produces: `data.updateFriend(id, { mbti })`（`mbti: MbtiCode` 设置，`mbti: null` 清除）。

- [ ] **Step 1: 写失败测试——updateFriend mbti 设置/清除**

在 `packages/miniapp/src/stores/__tests__/data.test.ts` 追加（沿用文件既有 store 构造/好友注入方式）：

```ts
it('updateFriend 设置与清除 userEdited.mbti', async () => {
  const store = /* 文件既有的建 store + 注入含 id:"u1" 好友的方式 */
  await store.updateFriend('u1', { mbti: 'INTJ' })
  expect(store.friends.find((f) => f.id === 'u1')!.userEdited.mbti).toBe('INTJ')

  await store.updateFriend('u1', { mbti: null })
  expect(store.friends.find((f) => f.id === 'u1')!.userEdited.mbti).toBeUndefined()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/data.test.ts`
Expected: FAIL —— `updateFriend` 不接受 `mbti` / 类型报错或断言失败。

- [ ] **Step 3: data.ts 扩展 updateFriend**

- 顶部 import 补 `MbtiCode` 类型：把 `import type { Friend, ReportData, Relation } from '@nianlun/core'` 改为 `import type { Friend, ReportData, Relation, MbtiCode } from '@nianlun/core'`。
- 把 `updateFriend` 签名与体改为：

```ts
    async function updateFriend(
      id: string,
      patch: { role?: string; rel?: Relation; alias?: string; mbti?: MbtiCode | null },
    ) {
      const f = friends.value.find((x) => x.id === id)
      if (!f) return
      if (patch.role !== undefined) { f.role = patch.role; f.userEdited.role = patch.role }
      if (patch.rel !== undefined) { f.rel = patch.rel; f.userEdited.rel = patch.rel }
      if (patch.alias !== undefined) { f.alias = patch.alias; f.userEdited.alias = patch.alias }
      if (patch.mbti !== undefined) {
        if (patch.mbti === null) delete f.userEdited.mbti
        else f.userEdited.mbti = patch.mbti
      }
      storage.saveFriends(JSON.parse(JSON.stringify(friends.value)))
    }
```

- [ ] **Step 4: 运行 data 测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/data.test.ts`
Expected: PASS。

- [ ] **Step 5: friend-detail.vue 加 MBTI 卡片 —— 脚本**

在 `<script setup>` 内：

- import 补：
```ts
import { effectiveMbtiCode, mbtiTitle, MBTI_CODES } from '@nianlun/core'
import type { MbtiResult } from '@nianlun/core'
```
- 在 profile 的 ref 群附近新增状态：
```ts
const mbtiAi = ref<MbtiResult | null>(null)
const mbtiStale = ref(false)
const loadingMbti = ref(false)
const MBTI_SRC_LABEL: Record<string, string> = { manual: '手动', remark: '备注', ai: 'AI', none: '' }
const AXIS_POLES: Record<string, [string, string]> = {
  EI: ['E 外向', 'I 内向'], SN: ['S 实感', 'N 直觉'], TF: ['T 思考', 'F 情感'], JP: ['J 判断', 'P 知觉'],
}
const mbtiEff = computed(() =>
  friend.value ? effectiveMbtiCode(friend.value, mbtiAi.value?.code ?? null) : { code: null, source: 'none' as const },
)
const mbtiPickerOptions = [...MBTI_CODES, '清除']

async function analyzeMbti() {
  const f = friend.value
  if (!f || loadingMbti.value) return
  const s = samples.loadSamplesFor(f.id)
  loadingMbti.value = true
  try {
    const r = await aiClient.analyzeFriendMbti(f, s)
    if (r) { mbtiAi.value = r; storage.saveFriendMbti(f.id, f, r); mbtiStale.value = false }
    else uni.showToast({ title: 'AI 未能判断 MBTI', icon: 'none' })
  } finally { loadingMbti.value = false }
}

function onMbtiPick(e: { detail: { value: number | string } }) {
  const f = friend.value
  if (!f) return
  const i = Number(e.detail.value)
  if (i >= MBTI_CODES.length) data.updateFriend(f.id, { mbti: null })
  else data.updateFriend(f.id, { mbti: MBTI_CODES[i] })
}
```
- 在既有「进页/返回时装载持久化缓存」的加载块里（加载 sentiment/profile 的那段，约第 191–198 行）追加：
```ts
  const mb = storage.loadFriendMbti(f.id, f)
  if (mb) { mbtiAi.value = mb.data; mbtiStale.value = mb.stale }
```
> 该加载块可能出现两处（进页 onLoad 与从设置返回 onShow，见第 196/236 行附近）；两处都追加，保持与 sentiment/profile 一致。

- [ ] **Step 6: friend-detail.vue 加 MBTI 卡片 —— 模板**

在好友画像卡片（`<view v-if="profile" class="card block">…`，约第 449 行）之后新增：

```html
      <view class="card block">
        <view class="mbti-head">
          <text class="block-t">MBTI 人格</text>
          <text v-if="mbtiEff.code" class="mbti-src">{{ MBTI_SRC_LABEL[mbtiEff.source] }}</text>
        </view>
        <text v-if="mbtiStale && mbtiEff.source === 'ai'" class="astro-stale" @click="analyzeMbti">数据已更新，点「重新分析」刷新</text>

        <view v-if="mbtiEff.code" class="mbti-code-row">
          <text class="mbti-code">{{ mbtiEff.code }}</text>
          <text class="mbti-title">{{ mbtiTitle(mbtiEff.code) }}</text>
        </view>
        <text v-else class="prof-v">尚未识别，可从备注写入类型码、AI 分析或手动选择。</text>

        <view v-if="mbtiAi" class="mbti-dims">
          <view v-for="d in mbtiAi.dimensions" :key="d.axis" class="mbti-dim">
            <text class="mbti-dim-l">{{ AXIS_POLES[d.axis][0] }}</text>
            <view class="mbti-bar">
              <view
                class="mbti-fill"
                :class="{ right: d.pole === d.axis[1] }"
                :style="{ width: d.strength + '%' }"
              ></view>
            </view>
            <text class="mbti-dim-r">{{ AXIS_POLES[d.axis][1] }}</text>
          </view>
        </view>
        <text v-if="mbtiAi && mbtiAi.summary" class="prof-v mbti-summary">{{ mbtiAi.summary }}</text>

        <view class="mbti-acts">
          <picker :range="mbtiPickerOptions" @change="onMbtiPick">
            <text class="act">✎ 手动设置</text>
          </picker>
          <text
            v-if="mbtiEff.source === 'ai' || mbtiEff.source === 'none'"
            class="act act-ai"
            @click="analyzeMbti"
          >{{ loadingMbti ? '分析中…' : (mbtiAi ? '↻ 重新分析' : '✦ AI 分析 MBTI') }}</text>
        </view>
      </view>
```

- 在 `<style>` 末尾追加（贴合现有卡片风格；`.act`/`.act-ai`/`.astro-stale`/`.block-t`/`.prof-v` 复用现有类）：

```css
.mbti-head { display: flex; align-items: center; justify-content: space-between; }
.mbti-src { font-size: 22rpx; color: #8a8f99; }
.mbti-code-row { display: flex; align-items: baseline; gap: 16rpx; margin: 12rpx 0; }
.mbti-code { font-size: 48rpx; font-weight: 700; letter-spacing: 4rpx; }
.mbti-title { font-size: 26rpx; color: #5a7fd0; }
.mbti-dims { margin: 12rpx 0; }
.mbti-dim { display: flex; align-items: center; gap: 12rpx; margin: 8rpx 0; }
.mbti-dim-l, .mbti-dim-r { font-size: 22rpx; color: #8a8f99; width: 120rpx; }
.mbti-dim-r { text-align: right; }
.mbti-bar { flex: 1; height: 12rpx; background: #eceef2; border-radius: 6rpx; overflow: hidden; position: relative; }
.mbti-fill { height: 100%; background: #5a7fd0; }
.mbti-fill.right { margin-left: auto; }
.mbti-summary { display: block; margin-top: 8rpx; }
.mbti-acts { display: flex; align-items: center; gap: 24rpx; margin-top: 12rpx; }
```

- [ ] **Step 7: 类型检查 + 全量测试**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: 全绿。

> 页面为 uni-app，无独立组件单测；卡片渲染以 `pnpm --filter @nianlun/miniapp dev` 手动核对（见 Task 6 末尾统一验收）。

- [ ] **Step 8: Commit**

```bash
git add packages/miniapp/src/stores/data.ts packages/miniapp/src/stores/__tests__/data.test.ts packages/miniapp/src/pages/friend-detail/friend-detail.vue
git commit -m "feat(miniapp): 好友详情页 MBTI 卡片(四维+解读+来源+手改+AI 分析)"
```

---

## Task 6: 好友列表 MBTI 徽标

**Files:**
- Modify: `packages/miniapp/src/pages/friends/friends.vue`

**Interfaces:**
- Consumes: `effectiveMbtiCode`（core）、`storage.loadFriendMbti`（Task 4）、`data.friends`（现有）。

- [ ] **Step 1: friends.vue 脚本——构建有效码映射**

在 `<script setup>`：
- import 补：
```ts
import { watch } from 'vue' // 若已从 'vue' 引入，合并到既有 import
import { storage } from '../../adapters/storage'
import { effectiveMbtiCode } from '@nianlun/core'
```
- 在 `const data = useDataStore()` 之后新增：
```ts
const mbtiMap = ref<Record<string, string>>({})
function refreshMbti() {
  const m: Record<string, string> = {}
  for (const f of data.friends) {
    const ai = storage.loadFriendMbti(f.id, f)?.data.code ?? null
    const { code } = effectiveMbtiCode(f, ai)
    if (code) m[f.id] = code
  }
  mbtiMap.value = m
}
watch(() => data.friends, refreshMbti, { immediate: true, deep: false })
```
> 只读已持久化的 AI 缓存 + 离线的手改/备注识别，**不触发**任何新 AI 分析。列表数据变化（导入/编辑）时经 watch 刷新。

- [ ] **Step 2: friends.vue 模板——每行徽标**

在好友行的关系 tag 附近（`<view class="tag" …>{{ f.rel }}</view>`，约第 85 行）之后新增：

```html
              <view v-if="mbtiMap[f.id]" class="mbti-badge">{{ mbtiMap[f.id] }}</view>
```

- 在 `<style>` 末尾追加：

```css
.mbti-badge {
  display: inline-block; margin-left: 12rpx; padding: 2rpx 12rpx;
  font-size: 20rpx; letter-spacing: 2rpx; color: #5a7fd0;
  background: rgba(90, 127, 208, 0.12); border-radius: 8rpx;
}
```

- [ ] **Step 3: 类型检查 + 全量测试**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: 全绿。

- [ ] **Step 4: 手动验收（dev 跑起来）**

Run: `pnpm --filter @nianlun/miniapp dev`（或用 `start_skill`）
核对：
1. 好友备注里含 `INTJ` → 列表该行显示 `INTJ` 徽标，详情页卡片来源标「备注」。
2. 详情页「手动设置」选 `ENFP` → 徽标/卡片变 `ENFP`，来源标「手动」；选「清除」→ 回落到备注/AI。
3. 无备注好友点「AI 分析 MBTI」→ 出四维条 + 解读，来源标「AI」，刷新后仍在；导入新数据后卡片顶部出现「数据已更新」软提示。

- [ ] **Step 5: 全仓测试 + Commit**

Run: `pnpm -r test`
Expected: core 与 miniapp 全绿。

```bash
git add packages/miniapp/src/pages/friends/friends.vue
git commit -m "feat(miniapp): 好友列表按有效码显示 MBTI 徽标"
```

---

## Self-Review

**Spec coverage：**
- core 类型/常量/detect/prompt/parse/effective → Task 1–3 ✅
- Friend.userEdited.mbti + merge 保留 → Task 1 ✅
- aiClient.analyzeFriendMbti → Task 4 ✅
- storage 好友级持久化 + 指纹 + clearAll → Task 4 ✅
- 详情页卡片（类型/四维/解读/来源/stale/手改/AI 按钮）→ Task 5 ✅
- 列表徽标（有效码，不做筛选）→ Task 6 ✅
- 测试（detect/parse/effective/merge/storage/aiClient/data）→ 各任务内 ✅

**Placeholder scan：** 无 TODO/TBD；所有代码步给出完整代码。测试中「沿用文件既有构造方式」处已标注对齐既有辅助，非占位。

**Type consistency：** `MbtiResult`/`MbtiCode`/`MbtiSource`/`effectiveMbtiCode` 返回 `{code, source}`、`updateFriend` 的 `mbti: MbtiCode | null`、`loadFriendMbti` 返回 `{data, stale}` 在各任务间一致；`detectMbtiFromText` 参数/返回一致；`MBTI_CODES` 顺序即 picker 顺序（`onMbtiPick` 用 `MBTI_CODES[i]`）。

**决策记录：** `MbtiCode` 放 `model/types.ts`（非 spec 的 ai/mbti.ts）以避免 `types.ts ↔ ai/mbti.ts` 循环依赖——`userEdited.mbti` 需引用它。其余与 spec 一致。
