# 深度关系分析（Relation Deep）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个 per-friend 的「深度关系分析」能力——core 出一个大 prompt + 容错解析器产出 10 块心理分析 JSON，miniapp 新页把它精排成卡片并 canvas 导出为可保存到相册的文字长海报。

**Architecture:** 严格遵守单向依赖 `miniapp → core`；core 保持纯函数、绝不碰 DOM。沿用现有 AI 模块的三件套范式（`build*Prompt` + `parse*` + 类型，见 `sentiment.ts`），沿用 storage 的「指纹缓存」范式（见 `saveFriendMbti`），沿用 report 页的 canvas 出图范式（`canvasToTempFilePath → saveImageToPhotosAlbum`）。安全感曲线复用本地已算好的 `friend.emotion.monthly` + 现有已测试的 `moodDualLinePoints`（不依赖任何 AI 缓存）。

**Tech Stack:** TypeScript（core 纯库，`"lib":["ES2020"]`，禁 DOM/`types:[]`）、Vue 3 + uni-app（miniapp）、Vitest 测试、pnpm workspace。

## Global Constraints

- **单向依赖**：`@nianlun/core` 不得 import miniapp、不得触碰 `window`/`document`/`IndexedDB`/`wx`/`uni`/`vue`。core 输入普通数据、输出普通数据。
- **解析器容错**：所有 `parse*` 函数遇到坏 JSON / 非字符串入参一律返回空对象 `{}`，**永不抛异常**。
- **隐私**：只发送该好友的有界样本 + 聚合统计；发送前弹 `uni.showModal` 确认框。原始聊天绝不落盘；分析结果 JSON 缓存于 `meta` 库；海报只把生成图片存相册。
- **命名**：core 新文件 `packages/core/src/ai/relationDeep.ts`；类型名 `RelationDeep`；函数名 `buildRelationDeepPrompt` / `parseRelationDeep`；storage 键 `nianlun:friendRelationDeep`；aiClient 方法 `analyzeRelationDeep`；新页路径 `pages/relation-deep/relation-deep`。
- **命令**：core 测试 `pnpm --filter @nianlun/core test`；miniapp 测试 `pnpm --filter @nianlun/miniapp test`；单文件 `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/relationDeep.test.ts`。core 改动后需 `pnpm --filter @nianlun/core build`（miniapp 依赖其 dist）。
- **无 .vue 页面测试约定**：本仓库不对 `.vue` 页面做 mount 测试（现存 0 个）。页面逻辑靠可测的 core/adapters/lib 纯函数覆盖；页面本身走「构建 + 微信开发者工具」手动验证。

---

### Task 1: core `relationDeep.ts`（类型 + prompt + 容错解析器）

**Files:**
- Create: `packages/core/src/ai/relationDeep.ts`
- Create: `packages/core/src/ai/__tests__/relationDeep.test.ts`
- Modify: `packages/core/src/index.ts`（新增导出）

**Interfaces:**
- Consumes: `Friend`（`packages/core/src/model/types.ts`，字段含 `alias/name/rel/role/msgCount/sentRatio/peakPeriod/monthly`）。
- Produces:
  - `interface RelationDeep`（见下方完整定义）
  - `buildRelationDeepPrompt(friend: Friend, samples: string[]): string`
  - `parseRelationDeep(text: string): RelationDeep`

- [ ] **Step 1: 写失败测试** — `packages/core/src/ai/__tests__/relationDeep.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { buildRelationDeepPrompt, parseRelationDeep } from '../relationDeep'
import type { Friend } from '../../model/types'

const FRIEND = {
  id: 'f1', name: '张三', alias: '', rel: '挚友', role: '产品经理',
  msgCount: 1200, sentRatio: 55, peakPeriod: '晚上',
  monthly: [10, 20, 0, 30, 40, 5, 0, 12, 22, 33, 8, 15],
} as unknown as Friend

describe('buildRelationDeepPrompt', () => {
  it('prompt 含好友名、样本行与 10 块关键字段名', () => {
    const p = buildRelationDeepPrompt(FRIEND, ['我：在吗', '对方：在'])
    expect(p).toContain('张三')
    expect(p).toContain('我：在吗')
    // 10 块字段名都要在格式说明里出现
    for (const key of ['overall', 'attachment', 'interaction', 'needs', 'uniqueness',
      'security', 'power', 'triggers', 'language', 'suggestions']) {
      expect(p).toContain(key)
    }
  })

  it('prompt 要求引原句、无线索填占位、禁止臆测', () => {
    const p = buildRelationDeepPrompt(FRIEND, [])
    expect(p).toContain('暂无足够线索')
    expect(p).toContain('原句')
    expect(p).toContain('（本次无可用聊天样本）')
  })
})

describe('parseRelationDeep', () => {
  it('解析完整 JSON 的所有嵌套块', () => {
    const json = JSON.stringify({
      overall: '一场追逐-回避之舞',
      attachment: { me: { style: '焦虑型', desc: '渴求回应' }, other: { style: '回避型', desc: '重视独处' } },
      interaction: { initiative: '你主动', expression: '你直接 TA 克制', conflict: '追逐-回避循环' },
      needs: { me: '在场感', other: '自主性' },
      uniqueness: { sharedMemory: '并购案', ritual: '妈妈闺女互称' },
      security: { summary: '前高后低', turningPoints: [{ month: 9, event: '冷战', direction: '下降' }] },
      power: { summary: '你更投入', whoLeads: '你', dependency: '你依赖 TA' },
      triggers: { me: [{ trigger: '被已读不回', reaction: '追问' }], other: [{ trigger: '被逼表态', reaction: '沉默' }] },
      language: { appellation: '妈妈/闺女', catchphrases: '在忙什么', emoji: '拥抱', latency: 'TA 慢半拍' },
      suggestions: [{ topic: '沟通模式', problem: '追逐-回避', advice: '设暂停信号' }],
    })
    const r = parseRelationDeep(json)
    expect(r.overall).toBe('一场追逐-回避之舞')
    expect(r.attachment?.me?.style).toBe('焦虑型')
    expect(r.interaction?.conflict).toBe('追逐-回避循环')
    expect(r.needs?.other).toBe('自主性')
    expect(r.security?.turningPoints?.[0]).toEqual({ month: 9, event: '冷战', direction: '下降' })
    expect(r.power?.whoLeads).toBe('你')
    expect(r.triggers?.me?.[0]).toEqual({ trigger: '被已读不回', reaction: '追问' })
    expect(r.language?.emoji).toBe('拥抱')
    expect(r.suggestions?.[0]?.advice).toBe('设暂停信号')
  })

  it('剥代码围栏后仍能解析', () => {
    const r = parseRelationDeep('```json\n{"overall":"很好"}\n```')
    expect(r.overall).toBe('很好')
  })

  it('缺块只产出有值的字段', () => {
    const r = parseRelationDeep('{"overall":"仅此一段"}')
    expect(r.overall).toBe('仅此一段')
    expect(r.attachment).toBeUndefined()
    expect(r.suggestions).toBeUndefined()
  })

  it('坏 JSON / 非字符串入参返回 {} 且不抛异常', () => {
    expect(parseRelationDeep('not json at all')).toEqual({})
    expect(parseRelationDeep('{oops')).toEqual({})
    expect(parseRelationDeep(123 as unknown as string)).toEqual({})
    expect(parseRelationDeep('')).toEqual({})
  })

  it('脏数组元素被过滤，空块被省略', () => {
    const r = parseRelationDeep(JSON.stringify({
      triggers: { me: [{ trigger: '', reaction: '' }, { trigger: '雷区', reaction: '' }] },
      suggestions: [{ topic: '', problem: '', advice: '' }],
    }))
    expect(r.triggers?.me).toEqual([{ trigger: '雷区' }])
    expect(r.suggestions).toBeUndefined()  // 全空建议被过滤后数组为空 → 省略
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/relationDeep.test.ts`
Expected: FAIL（`Cannot find module '../relationDeep'`）

- [ ] **Step 3: 写实现** — `packages/core/src/ai/relationDeep.ts`

```ts
import type { Friend } from '../model/types'

export interface AttachmentSide { style?: string; desc?: string }
export interface Trigger { trigger?: string; reaction?: string }
export interface SecurityTurningPoint { month?: number; event?: string; direction?: '上升' | '下降' }
export interface Suggestion { topic?: string; problem?: string; advice?: string }

export interface RelationDeep {
  overall?: string
  attachment?: { me?: AttachmentSide; other?: AttachmentSide }
  interaction?: { initiative?: string; expression?: string; conflict?: string }
  needs?: { me?: string; other?: string }
  uniqueness?: { sharedMemory?: string; ritual?: string }
  security?: { summary?: string; turningPoints?: SecurityTurningPoint[] }
  power?: { summary?: string; whoLeads?: string; dependency?: string }
  triggers?: { me?: Trigger[]; other?: Trigger[] }
  language?: { appellation?: string; catchphrases?: string; emoji?: string; latency?: string }
  suggestions?: Suggestion[]
}

/**
 * 深度关系分析提示词：依据聚合统计 + 有界样本，要求 AI 输出严格 JSON 的 10 块心理分析。
 * 理论内核：成人依恋理论（焦虑/回避/安全型）、追逐-回避(Demand-Withdraw)冲突模型、
 * 非暴力沟通(NVC)用于优化建议。逐月消息数写入 prompt，安全感/触发点须引原句佐证。
 */
export function buildRelationDeepPrompt(friend: Friend, samples: string[]): string {
  const displayName = friend.alias || friend.name
  const sampleBlock = samples.length
    ? samples.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '（本次无可用聊天样本）'
  const monthly = (friend.monthly ?? []).map((c, i) => `${i + 1}月:${c}`).join(' ')

  return [
    '你是一位受过训练、擅长成人依恋与亲密关系分析的心理咨询师。请依据下面这位微信好友',
    '与用户的往来统计和部分聊天样本，产出一份深入、克制、有依据的「深度关系分析」。',
    '理论框架：成人依恋理论（焦虑型/回避型/安全型/混乱型）、追逐-回避（Demand-Withdraw）',
    '冲突模型、非暴力沟通（NVC）。分析要具体、引用聊天里的原句作佐证，不空泛、不套话。',
    '',
    '只输出一个严格的 JSON 对象，不要任何解释、不要代码围栏外的文字。格式：',
    '{',
    '  "overall": "<整体评估：一段定调，点出关系张力与核心互动模式，120~200 字>",',
    '  "attachment": {',
    '    "me": {"style": "<我方依恋类型>", "desc": "<解读，引原句，60~120 字>"},',
    '    "other": {"style": "<对方依恋类型>", "desc": "<解读，引原句，60~120 字>"}',
    '  },',
    '  "interaction": {',
    '    "initiative": "<沟通主动性：谁发起、谁推动，60~120 字>",',
    '    "expression": "<情感表达差异：直接/克制、正面/负面各如何，60~120 字>",',
    '    "conflict": "<冲突处理：套用追逐-回避等模型，60~120 字>"',
    '  },',
    '  "needs": {"me": "<我方核心情感需求，40~80 字>", "other": "<对方核心情感需求，40~80 字>"},',
    '  "uniqueness": {"sharedMemory": "<只属于你们的共同记忆/话题>", "ritual": "<你们独特的互动仪式/角色扮演>"},',
    '  "security": {',
    '    "summary": "<安全感/信任如何随时间消长，结合逐月消息数，80~140 字>",',
    '    "turningPoints": [<关键转折，每项>{"month": <1-12>, "event": "<发生了什么，引原句>", "direction": "上升" 或 "下降"}]',
    '  },',
    '  "power": {"summary": "<权力/主导权总述，谁更投入、谁掌控节奏>", "whoLeads": "<谁主导：我/对方/均衡>", "dependency": "<依赖与被依赖关系>"},',
    '  "triggers": {',
    '    "me": [<我方情绪雷区，每项>{"trigger": "<什么话题/行为会触发>", "reaction": "<典型反应，引原句>"}],',
    '    "other": [<对方情绪雷区，每项>{"trigger": "<...>", "reaction": "<...>"}]',
    '  },',
    '  "language": {"appellation": "<称呼习惯>", "catchphrases": "<口头禅/高频语>", "emoji": "<表情包习惯>", "latency": "<回复时延与节奏>"},',
    '  "suggestions": [<优化建议，每项成对>{"topic": "<主题，如 沟通模式/情感表达>", "problem": "<问题诊断>", "advice": "<可执行建议，可用 NVC 四步>"}]',
    '}',
    '',
    '要求：任一字段若样本中无可靠线索，值填「暂无足够线索」，禁止臆测（尤其感情、家庭、财富）。',
    'turningPoints / triggers / suggestions 若无内容给空数组 []。',
    '',
    '聚合统计：',
    `- 好友：${displayName}`,
    `- 关系标签：${friend.rel}`,
    `- 职务/备注：${friend.role || '（未填）'}`,
    `- 全年消息往来：${friend.msgCount} 条`,
    `- 我方发送占比：${friend.sentRatio}%`,
    `- 活跃时段：${friend.peakPeriod || '（无）'}`,
    `- 逐月消息数：${monthly}`,
    '',
    '部分聊天样本（「我」为用户本人，「对方」为该好友）：',
    sampleBlock,
  ].join('\n')
}

// ── 容错取值助手 ──────────────────────────────
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}
function obj(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
/** 保留至少有一个非空字段的对象，全空则返回 undefined。 */
function compact<T extends object>(o: T): T | undefined {
  return Object.keys(o).length ? o : undefined
}

function pickSide(v: unknown): AttachmentSide | undefined {
  const o = obj(v); if (!o) return undefined
  const out: AttachmentSide = {}
  const style = str(o.style); if (style) out.style = style
  const desc = str(o.desc); if (desc) out.desc = desc
  return compact(out)
}
function pickTriggers(v: unknown): Trigger[] {
  return arr(v).map((e) => {
    const o = obj(e); if (!o) return {}
    const out: Trigger = {}
    const t = str(o.trigger); if (t) out.trigger = t
    const rx = str(o.reaction); if (rx) out.reaction = rx
    return out
  }).filter((t) => Object.keys(t).length > 0)
}

/**
 * 容错解析深度关系分析 JSON：剥围栏、定位首尾花括号、逐块取值；
 * 空块/空数组一律省略；坏 JSON / 非字符串入参返回 {}，永不抛异常。
 */
export function parseRelationDeep(text: string): RelationDeep {
  if (typeof text !== 'string') return {}
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return {}
  let raw: unknown
  try { raw = JSON.parse(text.slice(start, end + 1)) } catch { return {} }
  const r = obj(raw); if (!r) return {}
  const out: RelationDeep = {}

  const overall = str(r.overall); if (overall) out.overall = overall

  const att = obj(r.attachment)
  if (att) {
    const me = pickSide(att.me); const other = pickSide(att.other)
    const block = compact({ ...(me ? { me } : {}), ...(other ? { other } : {}) })
    if (block) out.attachment = block
  }

  const inter = obj(r.interaction)
  if (inter) {
    const block: NonNullable<RelationDeep['interaction']> = {}
    const a = str(inter.initiative); if (a) block.initiative = a
    const b = str(inter.expression); if (b) block.expression = b
    const c = str(inter.conflict); if (c) block.conflict = c
    if (compact(block)) out.interaction = block
  }

  const needs = obj(r.needs)
  if (needs) {
    const block: NonNullable<RelationDeep['needs']> = {}
    const me = str(needs.me); if (me) block.me = me
    const other = str(needs.other); if (other) block.other = other
    if (compact(block)) out.needs = block
  }

  const uniq = obj(r.uniqueness)
  if (uniq) {
    const block: NonNullable<RelationDeep['uniqueness']> = {}
    const sm = str(uniq.sharedMemory); if (sm) block.sharedMemory = sm
    const ri = str(uniq.ritual); if (ri) block.ritual = ri
    if (compact(block)) out.uniqueness = block
  }

  const sec = obj(r.security)
  if (sec) {
    const block: NonNullable<RelationDeep['security']> = {}
    const sm = str(sec.summary); if (sm) block.summary = sm
    const tps = arr(sec.turningPoints).map((e) => {
      const o = obj(e); if (!o) return {}
      const tp: SecurityTurningPoint = {}
      if (typeof o.month === 'number') tp.month = o.month
      const ev = str(o.event); if (ev) tp.event = ev
      if (o.direction === '上升' || o.direction === '下降') tp.direction = o.direction
      return tp
    }).filter((t) => Object.keys(t).length > 0)
    if (tps.length) block.turningPoints = tps
    if (compact(block)) out.security = block
  }

  const pow = obj(r.power)
  if (pow) {
    const block: NonNullable<RelationDeep['power']> = {}
    const s = str(pow.summary); if (s) block.summary = s
    const w = str(pow.whoLeads); if (w) block.whoLeads = w
    const d = str(pow.dependency); if (d) block.dependency = d
    if (compact(block)) out.power = block
  }

  const trig = obj(r.triggers)
  if (trig) {
    const me = pickTriggers(trig.me); const other = pickTriggers(trig.other)
    const block: NonNullable<RelationDeep['triggers']> = {}
    if (me.length) block.me = me
    if (other.length) block.other = other
    if (compact(block)) out.triggers = block
  }

  const lang = obj(r.language)
  if (lang) {
    const block: NonNullable<RelationDeep['language']> = {}
    const ap = str(lang.appellation); if (ap) block.appellation = ap
    const cp = str(lang.catchphrases); if (cp) block.catchphrases = cp
    const em = str(lang.emoji); if (em) block.emoji = em
    const la = str(lang.latency); if (la) block.latency = la
    if (compact(block)) out.language = block
  }

  const sugs = arr(r.suggestions).map((e) => {
    const o = obj(e); if (!o) return {}
    const s: Suggestion = {}
    const t = str(o.topic); if (t) s.topic = t
    const p = str(o.problem); if (p) s.problem = p
    const a = str(o.advice); if (a) s.advice = a
    return s
  }).filter((s) => Object.keys(s).length > 0)
  if (sugs.length) out.suggestions = sugs

  return out
}
```

- [ ] **Step 4: 在 index.ts 导出**

在 `packages/core/src/index.ts` 第 19 行（sentiment 类型导出）之后新增两行：

```ts
export { buildRelationDeepPrompt, parseRelationDeep } from './ai/relationDeep'
export type {
  RelationDeep, AttachmentSide, Trigger, SecurityTurningPoint, Suggestion,
} from './ai/relationDeep'
```

- [ ] **Step 5: 跑测试确认通过 + 构建 dist**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/relationDeep.test.ts && pnpm --filter @nianlun/core build`
Expected: 测试 PASS；build 成功（miniapp 依赖 dist）。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/ai/relationDeep.ts packages/core/src/ai/__tests__/relationDeep.test.ts packages/core/src/index.ts packages/core/dist
git commit -m "feat(core): 深度关系分析 prompt 与容错解析器（10 块心理分析）"
```

---

### Task 2: storage 缓存（saveRelationDeep / loadRelationDeep）

**Files:**
- Modify: `packages/miniapp/src/adapters/storage.ts`
- Modify: `packages/miniapp/src/adapters/__tests__/storage.test.ts`

**Interfaces:**
- Consumes: `RelationDeep`（Task 1）、现有内部助手 `saveFriendEntry` / `loadFriendEntry` / `friendFp`。
- Produces:
  - `storage.saveRelationDeep(id: string, friend: Friend, data: RelationDeep): void`
  - `storage.loadRelationDeep(id: string, friend: Friend): { data: RelationDeep; stale: boolean } | null`

- [ ] **Step 1: 写失败测试** — 追加到 `packages/miniapp/src/adapters/__tests__/storage.test.ts`

先看文件顶部现有 import 与 `makeStorage` 构造方式，照抄同款构造。新增测试块：

```ts
import type { RelationDeep } from '@nianlun/core'

describe('storage relationDeep', () => {
  it('save/load 往返，指纹一致时 stale=false', () => {
    const backend = memBackend()  // 复用本文件现有的内存 backend 工厂
    const s = makeStorage(backend)
    const friend = { id: 'f1', msgCount: 100, lastContact: 5 } as unknown as Friend
    const data: RelationDeep = { overall: '很好', suggestions: [{ topic: '沟通', advice: '多聊' }] }
    s.saveRelationDeep('f1', friend, data)
    const got = s.loadRelationDeep('f1', friend)
    expect(got?.data.overall).toBe('很好')
    expect(got?.stale).toBe(false)
  })

  it('好友统计变化（msgCount 变）→ stale=true', () => {
    const backend = memBackend()
    const s = makeStorage(backend)
    const f1 = { id: 'f1', msgCount: 100, lastContact: 5 } as unknown as Friend
    s.saveRelationDeep('f1', f1, { overall: 'x' })
    const f2 = { id: 'f1', msgCount: 200, lastContact: 9 } as unknown as Friend
    expect(s.loadRelationDeep('f1', f2)?.stale).toBe(true)
  })

  it('未存过返回 null', () => {
    const s = makeStorage(memBackend())
    expect(s.loadRelationDeep('nope', { id: 'nope', msgCount: 1, lastContact: 1 } as unknown as Friend)).toBeNull()
  })
})
```

> 注：`memBackend` 名称按本测试文件已有的内存 backend 工厂替换（若命名不同，用文件里现成的那个）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/storage.test.ts`
Expected: FAIL（`saveRelationDeep is not a function`）

- [ ] **Step 3: 写实现** — `packages/miniapp/src/adapters/storage.ts`

3a. 顶部第 1 行 import 追加 `RelationDeep` 类型：

```ts
import type { Friend, ReportData, BirthInfo, BaziChart, AstroReading, StockPick, Sentiment, FriendProfile, MbtiResult, RelationDeep } from '@nianlun/core'
```

3b. 常量区（第 12 行 `K_YEAR_MOOD` 之后）新增键：

```ts
const K_FRIEND_RELATION_DEEP = 'nianlun:friendRelationDeep'
```

3c. 在 `saveFriendMbti`/`loadFriendMbti`（约第 164-168 行）之后新增一对方法：

```ts
    saveRelationDeep(id: string, friend: Friend, data: RelationDeep): void {
      saveFriendEntry(K_FRIEND_RELATION_DEEP, id, friend, data)
    },
    loadRelationDeep(id: string, friend: Friend): { data: RelationDeep; stale: boolean } | null {
      return loadFriendEntry<RelationDeep>(K_FRIEND_RELATION_DEEP, id, friend)
    },
```

3d. `clearAll()` 里（约第 182 行 `backend.remove(K_FRIEND_MBTI)` 那行）追加清理：

```ts
      backend.remove(K_FRIEND_SENTIMENT); backend.remove(K_FRIEND_PROFILE); backend.remove(K_FRIEND_MBTI)
      backend.remove(K_FRIEND_RELATION_DEEP)
```

> 备份无需改：`isBackupKvKey` 对任意 `nianlun:` 且非 legacy 的键自动纳入备份，新键自动生效。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/storage.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/storage.ts packages/miniapp/src/adapters/__tests__/storage.test.ts
git commit -m "feat(miniapp): storage 新增深度关系分析结果缓存（指纹失效）"
```

---

### Task 3: aiClient.analyzeRelationDeep

**Files:**
- Modify: `packages/miniapp/src/adapters/aiClient.ts`
- Modify: `packages/miniapp/src/adapters/__tests__/aiClient.test.ts`

**Interfaces:**
- Consumes: `buildRelationDeepPrompt` / `parseRelationDeep` / `RelationDeep`（Task 1）、`Transport`。
- Produces: `aiClient.analyzeRelationDeep(friend: Friend, samples: string[]): Promise<RelationDeep>`

- [ ] **Step 1: 写失败测试** — 追加到 `packages/miniapp/src/adapters/__tests__/aiClient.test.ts`

```ts
  it('analyzeRelationDeep 把 prompt 交给 transport 并解析 10 块 JSON', async () => {
    const transport = vi.fn().mockResolvedValue(
      '{"overall":"追逐-回避","attachment":{"me":{"style":"焦虑型"}},"suggestions":[{"topic":"沟通","advice":"设暂停"}]}',
    )
    const out = await makeAiClient(transport).analyzeRelationDeep(FRIEND, ['我：在吗', '对方：在'])
    expect(out.overall).toBe('追逐-回避')
    expect(out.attachment?.me?.style).toBe('焦虑型')
    expect(out.suggestions?.[0]?.advice).toBe('设暂停')
    expect(transport.mock.calls[0][0]).toContain('张三')   // prompt 含好友名
  })
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/aiClient.test.ts`
Expected: FAIL（`analyzeRelationDeep is not a function`）

- [ ] **Step 3: 写实现** — `packages/miniapp/src/adapters/aiClient.ts`

3a. 顶部 core import 块追加：

```ts
  buildRelationDeepPrompt, parseRelationDeep,
```

3b. 类型 import 块追加 `RelationDeep`：

```ts
  ChatQaTurn, ChatQaContext, RelationDeep,
```

3c. 在 `analyzeFriendMbti` 方法之后新增（放在 `makeAiClient` 返回对象里）：

```ts
    async analyzeRelationDeep(friend: Friend, samples: string[]): Promise<RelationDeep> {
      const text = await transport(buildRelationDeepPrompt(friend, samples), 3072)
      return parseRelationDeep(text)
    },
```

> `maxTokens` 用 3072：10 块内容较长，高于其他单块（512~2048）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/aiClient.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/aiClient.ts packages/miniapp/src/adapters/__tests__/aiClient.test.ts
git commit -m "feat(miniapp): aiClient 新增 analyzeRelationDeep"
```

---

### Task 4: relation-deep 页面（渲染 10 块 + 入口 + 注册）

> **安全感曲线数据源（重要）：** 本仓库 storage **没有** DeepSentiment 缓存，切勿依赖它。安全感/信任曲线直接复用**已存在且已测试**的 `moodDualLinePoints`（`packages/miniapp/src/lib/insights.ts`）+ 本地已算好的 `friend.emotion.monthly`（`{ me:(MonthMood|null)[]; them:(MonthMood|null)[] }`，长度 12）。无需新写布局工具、无需额外测试（`insights.test.ts` 已覆盖 `moodDualLinePoints`）。

**Files:**
- Create: `packages/miniapp/src/pages/relation-deep/relation-deep.vue`
- Modify: `packages/miniapp/src/pages.json`
- Modify: `packages/miniapp/src/pages/friend-detail/friend-detail.vue`（新增入口按钮 + 跳转）

**Interfaces:**
- Consumes: `aiClient.analyzeRelationDeep`（Task 3）、`storage.saveRelationDeep`/`loadRelationDeep`（Task 2）、`samples.loadSamplesFor`、`moodDualLinePoints`（现有）+ `friend.emotion.monthly`（现有）、`useDataStore`。
- Produces: 一个 uni-app 页面，路由 `pages/relation-deep/relation-deep?id=<friendId>`。

> 说明：本任务无自动化测试（仓库不测 `.vue` 页面）。可测逻辑已在 Task 1-3 与现有 `insights.test.ts` 覆盖；本任务末尾做「构建 + 微信开发者工具」手动验证。

- [ ] **Step 1: 注册页面** — `packages/miniapp/src/pages.json` 的 `pages` 数组末尾追加一项

```json
    { "path": "pages/relation-deep/relation-deep", "style": { "navigationBarTitleText": "深度关系分析" } }
```

- [ ] **Step 2: friend-detail 加入口按钮 + 跳转** — `packages/miniapp/src/pages/friend-detail/friend-detail.vue`

2a. `<script setup>` 里新增跳转函数（放在已有 `analyzeMbti` 附近）：

```ts
function openRelationDeep() {
  const f = friend.value
  if (!f) return
  uni.navigateTo({ url: `/pages/relation-deep/relation-deep?id=${encodeURIComponent(f.id)}` })
}
```

2b. 模板里，好友画像动作（约第 473 行 `act-ai` 附近）旁新增一枚入口：

```html
          <text class="act act-ai" @click="openRelationDeep">✦ 深度关系分析</text>
```

- [ ] **Step 3: 创建页面** — `packages/miniapp/src/pages/relation-deep/relation-deep.vue`

```vue
<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { onLoad, onReady, onShow } from '@dcloudio/uni-app'
import { useDataStore } from '../../stores/data'
import { aiClient } from '../../adapters/aiClient'
import { samples } from '../../adapters/samples'
import { storage } from '../../adapters/storage'
import { moodDualLinePoints } from '../../lib/insights'
import type { RelationDeep } from '@nianlun/core'

const data = useDataStore()
const id = ref('')
onLoad((q) => { id.value = decodeURIComponent((q?.id as string) || '') })
const friend = computed(() => data.friends.find((f) => f.id === id.value) || null)
const displayName = computed(() => (friend.value ? (friend.value.alias || friend.value.name) : ''))

const deep = ref<RelationDeep | null>(null)
const stale = ref(false)
const loading = ref(false)

function loadCache() {
  const f = friend.value
  if (!f) return
  const d = storage.loadRelationDeep(f.id, f)
  if (d) { deep.value = d.data; stale.value = d.stale }
}

async function generate() {
  const f = friend.value
  if (!f || loading.value) return
  const s = samples.loadSamplesFor(f.id)
  const ok = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '深度关系分析',
      content: `将发送约 ${s.length} 条聊天片段到 AI 服务做心理分析，是否继续？`,
      success: (r) => resolve(r.confirm),
    })
  })
  if (!ok) return
  loading.value = true
  try {
    const r = await aiClient.analyzeRelationDeep(f, s)
    if (r.overall || r.attachment || r.suggestions) {
      deep.value = r
      storage.saveRelationDeep(f.id, f, r)   // 仅有效结果落盘
      stale.value = false
      nextTick(drawSecurity)
    } else {
      deep.value = { overall: 'AI 无法生成深度关系分析' } // 空结果不写盘，允许重试
    }
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loading.value = false
  }
}

// 安全感/信任曲线：复用本地已算好的逐月情绪(friend.emotion.monthly) + 现有 moodDualLinePoints，
// 画「我(暖)/对方(冷)」双线（沿用 friend-detail drawMood 套路）。无逐月情绪数据则不显示图。
const hasSecurityChart = computed(() => {
  const m = friend.value?.emotion?.monthly
  return !!m && moodDualLinePoints(m, { width: 300, height: 150, pad: 20 }).hasData
})
function drawSecurity() {
  const monthly = friend.value?.emotion?.monthly
  if (!monthly || !hasSecurityChart.value) return
  uni.createSelectorQuery().select('.sec-canvas').boundingClientRect((res) => {
    const rect = res as UniApp.NodeInfo
    const W = rect && rect.width ? rect.width : 300
    const H = rect && rect.height ? rect.height : 120
    const pad = 16
    const dl = moodDualLinePoints(monthly, { width: W, height: H, pad })
    const ctx = uni.createCanvasContext('secLine')
    const midY = H - pad - 0.5 * (H - 2 * pad)
    ctx.beginPath(); ctx.setStrokeStyle('#e5e7eb'); ctx.setLineWidth(1)
    ctx.moveTo(pad, midY); ctx.lineTo(W - pad, midY); ctx.stroke()
    const drawLine = (pts: typeof dl.me, color: string) => {
      ctx.setStrokeStyle(color); ctx.setLineWidth(2)
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].m - pts[i - 1].m !== 1) continue
        ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke()
      }
      for (const p of pts) { ctx.beginPath(); ctx.setFillStyle(color); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill() }
    }
    drawLine(dl.me, '#e8a04b')     // 我=暖
    drawLine(dl.them, '#5a8fd0')   // TA=冷
    ctx.draw()
  }).exec()
}

onShow(() => { loadCache(); nextTick(drawSecurity) })
onReady(() => { setTimeout(drawSecurity, 80) })
</script>

<template>
  <view class="page">
    <view v-if="!friend" class="empty">
      <view class="e-text">未找到该好友，返回好友页重试</view>
    </view>

    <template v-else>
      <!-- 头部 + 生成动作 -->
      <view class="head">
        <text class="h-name">{{ displayName }}</text>
        <text class="h-rel">{{ friend.rel }}</text>
        <text class="act" @click="generate">
          {{ loading ? '分析中…' : (deep ? '↻ 重新生成' : '✦ 生成深度关系分析') }}
        </text>
        <text v-if="stale" class="stale" @click="generate">数据已更新，点「重新生成」刷新</text>
      </view>

      <view v-if="!deep" class="ph">点上方按钮，让 AI 从依恋、互动、需求、安全感等 10 个维度剖析你们的关系。</view>

      <template v-else>
        <!-- ① 整体评估 -->
        <view v-if="deep.overall" class="banner"><text class="b-t">整体评估</text><text class="b-body">{{ deep.overall }}</text></view>

        <!-- ② 依恋风格 + ③ 互动模式（双栏） -->
        <view class="row">
          <view v-if="deep.attachment" class="card col">
            <text class="c-t">依恋风格分析</text>
            <view v-if="deep.attachment.me" class="sub">
              <text class="s-h">我 · {{ deep.attachment.me.style }}</text>
              <text class="s-b">{{ deep.attachment.me.desc }}</text>
            </view>
            <view v-if="deep.attachment.other" class="sub">
              <text class="s-h">对方 · {{ deep.attachment.other.style }}</text>
              <text class="s-b">{{ deep.attachment.other.desc }}</text>
            </view>
          </view>
          <view v-if="deep.interaction" class="card col">
            <text class="c-t">互动模式分析</text>
            <view v-if="deep.interaction.initiative" class="sub"><text class="s-h">沟通主动性</text><text class="s-b">{{ deep.interaction.initiative }}</text></view>
            <view v-if="deep.interaction.expression" class="sub"><text class="s-h">情感表达</text><text class="s-b">{{ deep.interaction.expression }}</text></view>
            <view v-if="deep.interaction.conflict" class="sub"><text class="s-h">冲突处理</text><text class="s-b">{{ deep.interaction.conflict }}</text></view>
          </view>
        </view>

        <!-- ④ 情感需求 + ⑤ 关系独特性（双栏） -->
        <view class="row">
          <view v-if="deep.needs" class="card col">
            <text class="c-t">情感需求分析</text>
            <view v-if="deep.needs.me" class="sub"><text class="s-h">我的需求</text><text class="s-b">{{ deep.needs.me }}</text></view>
            <view v-if="deep.needs.other" class="sub"><text class="s-h">对方的需求</text><text class="s-b">{{ deep.needs.other }}</text></view>
          </view>
          <view v-if="deep.uniqueness" class="card col">
            <text class="c-t">关系独特性分析</text>
            <view v-if="deep.uniqueness.sharedMemory" class="sub"><text class="s-h">共同记忆</text><text class="s-b">{{ deep.uniqueness.sharedMemory }}</text></view>
            <view v-if="deep.uniqueness.ritual" class="sub"><text class="s-h">互动仪式</text><text class="s-b">{{ deep.uniqueness.ritual }}</text></view>
          </view>
        </view>

        <!-- ⑥ 安全感/信任曲线（通栏，带折线图） -->
        <view v-if="deep.security" class="card">
          <text class="c-t">安全感 / 信任曲线</text>
          <text v-if="deep.security.summary" class="s-b">{{ deep.security.summary }}</text>
          <canvas v-if="hasSecurityChart" canvas-id="secLine" class="sec-canvas" />
          <view v-for="(tp, i) in deep.security.turningPoints" :key="i" class="tp">
            <text class="tp-m">{{ tp.month }}月 · {{ tp.direction }}</text>
            <text class="tp-e">{{ tp.event }}</text>
          </view>
        </view>

        <!-- ⑦ 权力/主导权（通栏） -->
        <view v-if="deep.power" class="card">
          <text class="c-t">权力 / 主导权关系</text>
          <text v-if="deep.power.summary" class="s-b">{{ deep.power.summary }}</text>
          <view v-if="deep.power.whoLeads" class="sub"><text class="s-h">主导方</text><text class="s-b">{{ deep.power.whoLeads }}</text></view>
          <view v-if="deep.power.dependency" class="sub"><text class="s-h">依赖关系</text><text class="s-b">{{ deep.power.dependency }}</text></view>
        </view>

        <!-- ⑧ 情绪触发点（双栏） -->
        <view v-if="deep.triggers" class="row">
          <view v-if="deep.triggers.me" class="card col">
            <text class="c-t">我的情绪触发点</text>
            <view v-for="(t, i) in deep.triggers.me" :key="i" class="sub"><text class="s-h">{{ t.trigger }}</text><text class="s-b">{{ t.reaction }}</text></view>
          </view>
          <view v-if="deep.triggers.other" class="card col">
            <text class="c-t">对方的情绪触发点</text>
            <view v-for="(t, i) in deep.triggers.other" :key="i" class="sub"><text class="s-h">{{ t.trigger }}</text><text class="s-b">{{ t.reaction }}</text></view>
          </view>
        </view>

        <!-- ⑨ 沟通语言模式（通栏） -->
        <view v-if="deep.language" class="card">
          <text class="c-t">沟通语言模式</text>
          <view v-if="deep.language.appellation" class="sub"><text class="s-h">称呼</text><text class="s-b">{{ deep.language.appellation }}</text></view>
          <view v-if="deep.language.catchphrases" class="sub"><text class="s-h">口头禅</text><text class="s-b">{{ deep.language.catchphrases }}</text></view>
          <view v-if="deep.language.emoji" class="sub"><text class="s-h">表情包</text><text class="s-b">{{ deep.language.emoji }}</text></view>
          <view v-if="deep.language.latency" class="sub"><text class="s-h">回复时延</text><text class="s-b">{{ deep.language.latency }}</text></view>
        </view>

        <!-- ⑩ 优化建议（通栏，红问题/绿建议） -->
        <view v-if="deep.suggestions" class="card">
          <text class="c-t">优化建议</text>
          <view v-for="(sg, i) in deep.suggestions" :key="i" class="sug">
            <text class="sug-topic">{{ sg.topic }}</text>
            <view v-if="sg.problem" class="sug-p"><text class="tag tag-p">问题</text><text class="s-b">{{ sg.problem }}</text></view>
            <view v-if="sg.advice" class="sug-a"><text class="tag tag-a">建议</text><text class="s-b">{{ sg.advice }}</text></view>
          </view>
        </view>
      </template>
    </template>
  </view>
</template>

<style scoped>
.page { padding: 24rpx; background: #f6f7f5; min-height: 100vh; }
.empty, .ph { padding: 60rpx 24rpx; color: #8a8f99; font-size: 28rpx; text-align: center; }
.head { display: flex; flex-direction: column; gap: 8rpx; margin-bottom: 20rpx; }
.h-name { font-size: 40rpx; font-weight: 700; color: #2f2b26; }
.h-rel { font-size: 26rpx; color: #8a8f99; }
.act { align-self: flex-start; margin-top: 12rpx; padding: 12rpx 24rpx; background: #eafaef; color: #2ea34a; border-radius: 999rpx; font-size: 28rpx; }
.stale { color: #d08a2c; font-size: 24rpx; }
.banner { background: #eef3fb; border-left: 6rpx solid #5a8fd0; border-radius: 12rpx; padding: 24rpx; margin-bottom: 20rpx; }
.b-t { display: block; color: #4a72b8; font-weight: 700; font-size: 30rpx; margin-bottom: 12rpx; }
.b-body { font-size: 28rpx; line-height: 1.7; color: #3a4657; }
.row { display: flex; gap: 16rpx; margin-bottom: 20rpx; }
.col { flex: 1; }
.card { background: #fff; border-radius: 14rpx; padding: 24rpx; margin-bottom: 20rpx; }
.c-t { display: block; color: #2ea34a; font-weight: 700; font-size: 30rpx; margin-bottom: 14rpx; }
.sub { margin-bottom: 14rpx; }
.s-h { display: block; color: #5a8fd0; font-size: 26rpx; font-weight: 600; margin-bottom: 4rpx; }
.s-b { font-size: 27rpx; line-height: 1.7; color: #4a443c; }
.sec-canvas { width: 100%; height: 200rpx; margin: 16rpx 0; }
.tp { display: flex; flex-direction: column; padding: 12rpx 0; border-top: 1rpx solid #f0f0ee; }
.tp-m { font-size: 25rpx; color: #d08a2c; }
.tp-e { font-size: 26rpx; color: #4a443c; }
.sug { padding: 16rpx 0; border-top: 1rpx solid #f0f0ee; }
.sug-topic { display: block; font-weight: 600; font-size: 28rpx; color: #2f2b26; margin-bottom: 10rpx; }
.sug-p, .sug-a { display: flex; gap: 10rpx; margin-bottom: 8rpx; }
.tag { flex: none; padding: 2rpx 12rpx; border-radius: 6rpx; font-size: 22rpx; height: 34rpx; line-height: 30rpx; }
.tag-p { background: #fdecec; color: #d05a5a; }
.tag-a { background: #eafaef; color: #2ea34a; }
</style>
```

> 安全感曲线说明：图表数据来自本地已算好的 `friend.emotion.monthly`（导入时算出，随 store 常驻），经现有 `moodDualLinePoints` 布局成「我(暖)/对方(冷)」双线。该好友无逐月情绪数据时 `hasSecurityChart=false`，安全感块降级为纯文字，页面照常工作。

- [ ] **Step 4: 构建并手动验证**

```bash
pnpm --filter @nianlun/miniapp build
```
然后用**微信开发者工具**打开 `packages/miniapp/dist/dev/mp-weixin`（或 build 产物），验证：
1. 导入数据后进好友详情页 → 见「✦ 深度关系分析」入口 → 点击跳转到新页，标题「深度关系分析」。
2. 点「生成深度关系分析」→ 弹确认框 → 确认后出现 10 块内容（有值的块才显示）。
3. 退出重进该页：命中缓存直显、不重复调用 AI。
4. 该好友有逐月情绪数据时：安全感块出现「我/对方」双线折线图。
Expected: 上述 4 点均通过；无 JS 报错。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/pages/relation-deep/relation-deep.vue packages/miniapp/src/pages.json packages/miniapp/src/pages/friend-detail/friend-detail.vue
git commit -m "feat(miniapp): 深度关系分析独立页（10 块卡片 + 入口 + 安全感曲线）"
```

---

### Task 5: canvas 长海报导出

**Files:**
- Modify: `packages/miniapp/src/pages/relation-deep/relation-deep.vue`（新增离屏 canvas + 导出逻辑）

**Interfaces:**
- Consumes: 页面里的 `deep`（`RelationDeep`）、`displayName`。
- Produces: 页面「保存长海报」动作 → 把 10 块渲染成一张米色文字长图存相册。

> 无自动化测试（canvas 渲染，仓库不测）。手动验证：生成图片后相册出现完整长图。

- [ ] **Step 1: 加导出逻辑** — `relation-deep.vue` 的 `<script setup>` 追加

```ts
// ── 长海报导出：动态高度，逐块「彩色标题 + 折行正文」 ──
const CW = 640
const CH = ref(900)   // 动态，measure 后回填

function wrapLines(ctx: any, text: string, maxW: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const ch of text) {
    if (ch === '\n') { lines.push(line); line = ''; continue }
    const test = line + ch
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = ch }
    else line = test
  }
  if (line) lines.push(line)
  return lines
}

// 把 deep 摊平成 [{title, body}] 段落序列（有值才进）。
function posterSegments(): { title: string; body: string }[] {
  const d = deep.value
  if (!d) return []
  const segs: { title: string; body: string }[] = []
  const push = (title: string, body?: string) => { if (body && body.trim()) segs.push({ title, body }) }
  push('整体评估', d.overall)
  if (d.attachment?.me) push('依恋 · 我', `${d.attachment.me.style ?? ''} ${d.attachment.me.desc ?? ''}`)
  if (d.attachment?.other) push('依恋 · 对方', `${d.attachment.other.style ?? ''} ${d.attachment.other.desc ?? ''}`)
  push('沟通主动性', d.interaction?.initiative)
  push('情感表达', d.interaction?.expression)
  push('冲突处理', d.interaction?.conflict)
  push('我的需求', d.needs?.me)
  push('对方的需求', d.needs?.other)
  push('共同记忆', d.uniqueness?.sharedMemory)
  push('互动仪式', d.uniqueness?.ritual)
  push('安全感/信任', d.security?.summary)
  push('权力/主导权', d.power?.summary)
  for (const t of d.triggers?.me ?? []) push('我的雷区', `${t.trigger ?? ''} → ${t.reaction ?? ''}`)
  for (const t of d.triggers?.other ?? []) push('对方雷区', `${t.trigger ?? ''} → ${t.reaction ?? ''}`)
  const lang = d.language
  if (lang) push('沟通语言', [lang.appellation, lang.catchphrases, lang.emoji, lang.latency].filter(Boolean).join('｜'))
  for (const s of d.suggestions ?? []) push(`建议 · ${s.topic ?? ''}`, [s.problem && `问题：${s.problem}`, s.advice && `建议：${s.advice}`].filter(Boolean).join('\n'))
  return segs
}

function drawPoster() {
  const segs = posterSegments()
  if (!segs.length) { uni.showToast({ title: '先生成分析再保存', icon: 'none' }); return }
  const ctx = uni.createCanvasContext('poster')
  const marginX = 48, maxW = CW - marginX * 2
  const titleH = 40, lineH = 40, gapAfterTitle = 8, gapAfterBlock = 28
  // 第一遍：measure 各块折行、累加高度（measureText 需先设字号）。
  ctx.setFontSize(26)
  const laid = segs.map((s) => {
    ctx.setFontSize(26)
    return { title: s.title, lines: wrapLines(ctx, s.body, maxW) }
  })
  let y = 150   // 头部留白
  for (const b of laid) y += titleH + gapAfterTitle + b.lines.length * lineH + gapAfterBlock
  y += 80       // 底部留白
  CH.value = y
  // 等 canvas 尺寸生效再画（uni 需 nextTick）。
  nextTick(() => {
    const c = uni.createCanvasContext('poster')
    c.setFillStyle('#fffdf6'); c.fillRect(0, 0, CW, CH.value)
    c.setStrokeStyle('#f3ead3'); c.setLineWidth(2); c.strokeRect(16, 16, CW - 32, CH.value - 32)
    c.setTextAlign('left')
    c.setFillStyle('#2ea34a'); c.setFontSize(26); c.fillText('深度关系分析', marginX, 70)
    c.setFillStyle('#2f2b26'); c.setFontSize(44); c.fillText(displayName.value, marginX, 122)
    let yy = 150
    for (const b of laid) {
      c.setFillStyle('#4a72b8'); c.setFontSize(28); c.fillText(b.title, marginX, yy + 28)
      yy += titleH + gapAfterTitle
      c.setFillStyle('#4a443c'); c.setFontSize(26)
      for (const ln of b.lines) { c.fillText(ln, marginX, yy + 26); yy += lineH }
      yy += gapAfterBlock
    }
    c.setFillStyle('#9a917f'); c.setFontSize(22)
    c.fillText('本地生成 · 数据从未离开你的手机', marginX, CH.value - 40)
    c.draw(false, () => {
      uni.canvasToTempFilePath({
        canvasId: 'poster',
        success: (res: { tempFilePath: string }) => {
          uni.saveImageToPhotosAlbum({
            filePath: res.tempFilePath,
            success: () => uni.showToast({ title: '已保存到相册' }),
            fail: () => uni.showToast({ title: '保存失败，请授权相册', icon: 'none' }),
          })
        },
        fail: () => uni.showToast({ title: '生成图片失败，请重试', icon: 'none' }),
      })
    })
  })
}
```

- [ ] **Step 2: 加导出按钮 + 离屏 canvas** — `relation-deep.vue` 模板

2a. 头部 `stale` 之后追加按钮（仅有分析结果时显示）：

```html
        <text v-if="deep" class="act" @click="drawPoster">📥 保存长海报</text>
```

2b. `</template>`（外层 v-else 的）末尾、`</view>`（.page）之前追加离屏 canvas：

```html
      <canvas canvas-id="poster" class="offscreen" :style="{ width: CW + 'px', height: CH + 'px' }" />
```

2c. `<style scoped>` 追加：

```css
.offscreen { position: fixed; left: -9999px; top: 0; }
```

- [ ] **Step 3: 构建并手动验证**

```bash
pnpm --filter @nianlun/miniapp build
```
微信开发者工具中：进 relation-deep 页 → 生成分析 → 点「📥 保存长海报」→ 授权相册 → 相册出现一张米色长图，含好友名 + 全部有值块的「彩色标题 + 正文」+ 底部隐私声明。
Expected: 图片完整、文字不溢出边界、无报错。（真机内存注意：块极多时图很长，属预期。）

- [ ] **Step 4: 提交**

```bash
git add packages/miniapp/src/pages/relation-deep/relation-deep.vue
git commit -m "feat(miniapp): 深度关系分析长海报导出（动态高度 canvas 存相册）"
```

---

## Self-Review

**Spec coverage：**
- core 模块（类型/prompt/parser + 导出）→ Task 1 ✅
- 10 块内容（6 原有 + 4 新增：安全感/权力/触发点/语言）→ Task 1 的 `RelationDeep` + prompt 全覆盖 ✅
- 隐私（有界样本 + 确认框 + 不落原文）→ Task 4 `generate` ✅
- 缓存/失效（指纹）→ Task 2 ✅
- aiClient 方法 → Task 3 ✅
- 安全感曲线（复用本地 `friend.emotion.monthly` + 现有已测 `moodDualLinePoints`，不依赖 DeepSentiment）→ Task 4 页面 canvas ✅
- 独立页 + 入口 + 10 块渲染 → Task 4 ✅
- canvas 长海报导出（动态高度、文字为主）→ Task 5 ✅
- 测试（core parser 容错 / storage 往返 / aiClient；安全感曲线沿用 `insights.test.ts` 已覆盖的 `moodDualLinePoints`）→ Task 1-3 + 现有测试 ✅
- 非目标（不做词云/雷达/散点进图、不做多好友批量）→ 计划未触及，符合 ✅

**修订记录：** 初稿曾设 Task 4「新写 securityLinePoints 布局工具 + 复用 DeepSentiment.timeline」；核实发现 storage 无 DeepSentiment 缓存，故删除该任务，安全感曲线改用已存在且已测试的 `moodDualLinePoints` + 本地 `friend.emotion.monthly`（YAGNI）。任务数由 6 降为 5。

**Placeholder scan：** 无 TBD/TODO；每个改代码的步骤都给了完整代码。`memBackend` 一处显式标注「用本测试文件现成的内存 backend 工厂替换」——因该工厂命名依赖既有测试文件，实现时按现状取用。

**Type consistency：** `RelationDeep` 及子类型在 Task 1 定义，Task 2/3/4/5 一致引用；安全感曲线复用现有 `moodDualLinePoints(monthly, opts)` 签名（`insights.ts`），页面调用与之一致；`buildRelationDeepPrompt`/`parseRelationDeep`/`analyzeRelationDeep`/`saveRelationDeep`/`loadRelationDeep` 全程同名。
