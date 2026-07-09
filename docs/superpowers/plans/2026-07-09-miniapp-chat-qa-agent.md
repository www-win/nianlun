# 微信聊天记录问答 Agent 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给小程序加一个多轮问答 agent，用户用大白话问关于自己微信聊天记录的任何事，agent 翻本机原文/样本/统计作答，答不出就承认、绝不编造。

**Architecture:** 方案 A「本机检索 + 单次应答」。每轮：miniapp 检索适配器组装上下文（点名好友→从 rawStore 读原文重解析裁剪；泛问→样本+统计）→ core 纯函数拼 prompt →复用现有 `aiClient` 走 `aiProxy` 单次调用。多轮=把最近几轮对话塞进 prompt。

**Tech Stack:** TypeScript、Vue3 + uni-app（小程序）、Pinia、Vitest。core 为纯 TS 库，miniapp 经 dist 消费 `@nianlun/core`。

## Global Constraints

- 单向依赖：`miniapp → core`；**core 永不 import miniapp、永不碰 wx/DOM**（`packages/core/tsconfig.json` 的 `"lib":["ES2020"]`/`"types":[]` 会让 DOM API 编译失败）。
- **miniapp 经 dist 解析 `@nianlun/core`**（`main/module/exports` 指向 `dist/`，无 src 别名）。改完 core 必须 `pnpm --filter @nianlun/core build`，miniapp 才能 import 到新导出。
- 所有代码注释与用户可见文案用中文。
- 页面从 store 读，绝不直接调 core；store 用「工厂 + deps 注入」模式，默认导出 `useXxxStore`，测试注入内存实现。
- wx 全局只能在函数体内访问，模块顶层不触碰（与现有 storage/aiClient/rawStore 约定一致）。
- 隐私：只有裁剪后的片段发给 aiProxy；原文始终在本机；对话仅存内存、不落盘。

---

### Task 1: core — 问题理解纯函数（类型 + selectRelevantFriends + extractKeywords）

**Files:**
- Create: `packages/core/src/ai/chatQa.ts`
- Create: `packages/core/src/ai/__tests__/chatQa.test.ts`
- Modify: `packages/core/src/index.ts`（新增导出）

**Interfaces:**
- Consumes: 无（纯函数，仅用内置类型）。
- Produces:
  - `interface ChatQaTurn { role: 'user' | 'assistant'; text: string }`
  - `interface RawExcerpt { friend: string; lines: string[] }`
  - `interface ChatQaContext { statsSummary: string; samples: string[]; rawExcerpts: RawExcerpt[] }`
  - `interface FriendRef { id: string; name: string; alias?: string; role?: string }`
  - `selectRelevantFriends(question: string, friends: FriendRef[]): string[]`
  - `extractKeywords(question: string, exclude?: string[]): string[]`

- [ ] **Step 1: 写失败测试**

创建 `packages/core/src/ai/__tests__/chatQa.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { selectRelevantFriends, extractKeywords } from '../chatQa'

const friends = [
  { id: 'wxid_a', name: '张三', alias: '', role: '大学室友' },
  { id: 'wxid_b', name: '李四', alias: '四姐', role: '' },
  { id: 'wxid_c', name: '王五', alias: '', role: '' },
]

describe('selectRelevantFriends', () => {
  it('按 name 命中', () => {
    expect(selectRelevantFriends('我和张三上次聊什么了', friends)).toEqual(['wxid_a'])
  })
  it('按 alias 命中', () => {
    expect(selectRelevantFriends('四姐最近怎么样', friends)).toEqual(['wxid_b'])
  })
  it('按 role 命中', () => {
    expect(selectRelevantFriends('我大学室友是谁', friends)).toEqual(['wxid_a'])
  })
  it('无命中返回空', () => {
    expect(selectRelevantFriends('我今年过得怎么样', friends)).toEqual([])
  })
  it('去重：同一好友多字段命中只返回一次', () => {
    expect(selectRelevantFriends('李四也就是四姐', friends)).toEqual(['wxid_b'])
  })
})

describe('extractKeywords', () => {
  it('抽取 2 字以上中文/字母数字词，去停用词', () => {
    const ks = extractKeywords('李四是不是提过要换工作', ['李四'])
    expect(ks).toContain('提过')
    expect(ks).toContain('要换工作')
    expect(ks).not.toContain('李四')     // 被 exclude
  })
  it('过滤单字与停用词', () => {
    const ks = extractKeywords('他什么时候来的')
    expect(ks).not.toContain('什么')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/chatQa.test.ts`
Expected: FAIL —— 找不到模块 `../chatQa` / 导出不存在。

- [ ] **Step 3: 写实现**

创建 `packages/core/src/ai/chatQa.ts`：

```ts
export interface ChatQaTurn { role: 'user' | 'assistant'; text: string }
export interface RawExcerpt { friend: string; lines: string[] }
export interface ChatQaContext {
  statsSummary: string
  samples: string[]
  rawExcerpts: RawExcerpt[]
}
export interface FriendRef { id: string; name: string; alias?: string; role?: string }

/** 问题里出现某好友的 name/alias/role(≥2 字)即命中；返回去重后的 friend id 列表。 */
export function selectRelevantFriends(question: string, friends: FriendRef[]): string[] {
  const ids: string[] = []
  for (const f of friends) {
    const keys = [f.alias, f.name, f.role].filter((v): v is string => !!v && v.length >= 2)
    if (keys.some((k) => question.includes(k)) && !ids.includes(f.id)) ids.push(f.id)
  }
  return ids
}

// 常见疑问/功能词，抽关键词时剔除，避免拿它们去匹配聊天原文造成噪声。
const STOPWORDS = new Set([
  '什么', '怎么', '为什么', '是不是', '有没有', '我们', '他们', '这个', '那个',
  '一下', '最近', '上次', '曾经', '现在', '已经', '可以', '知道', '告诉', '关于',
  '聊了', '聊过', '说过', '时候',
])

/** 从问题里抽 2 字以上的中文串或字母数字串作关键词，剔除 exclude(如好友名) 与停用词。 */
export function extractKeywords(question: string, exclude: string[] = []): string[] {
  let q = question
  for (const e of exclude) if (e) q = q.split(e).join(' ')
  const runs = q.match(/[一-龥]{2,}|[A-Za-z0-9]{2,}/g) ?? []
  const out: string[] = []
  for (const r of runs) {
    if (STOPWORDS.has(r)) continue
    if (!out.includes(r)) out.push(r)
  }
  return out
}
```

- [ ] **Step 4: 追加导出**

在 `packages/core/src/index.ts` 末尾追加：

```ts
export { selectRelevantFriends, extractKeywords } from './ai/chatQa'
export type { ChatQaTurn, RawExcerpt, ChatQaContext, FriendRef } from './ai/chatQa'
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/chatQa.test.ts`
Expected: PASS（全部用例通过）。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/ai/chatQa.ts packages/core/src/ai/__tests__/chatQa.test.ts packages/core/src/index.ts
git commit -m "feat(core): 聊天问答 selectRelevantFriends/extractKeywords 与类型"
```

---

### Task 2: core — buildChatQaPrompt + parseChatQaAnswer

**Files:**
- Modify: `packages/core/src/ai/chatQa.ts`（追加两个函数）
- Modify: `packages/core/src/ai/__tests__/chatQa.test.ts`（追加测试）
- Modify: `packages/core/src/index.ts`（追加导出）

**Interfaces:**
- Consumes: Task 1 的 `ChatQaTurn`、`ChatQaContext`。
- Produces:
  - `buildChatQaPrompt(question: string, history: ChatQaTurn[], context: ChatQaContext): string`
  - `parseChatQaAnswer(text: string): string`

- [ ] **Step 1: 写失败测试**

在 `packages/core/src/ai/__tests__/chatQa.test.ts` 顶部 import 追加 `buildChatQaPrompt, parseChatQaAnswer`，并在文件末尾追加：

```ts
import type { ChatQaContext, ChatQaTurn } from '../chatQa'

const ctx: ChatQaContext = {
  statsSummary: '年份2024；好友30位；全年消息1234条。',
  samples: ['我：在吗', '对方：在'],
  rawExcerpts: [{ friend: '张三', lines: ['2024-03-01 我：吃了吗', '2024-03-01 张三：吃了'] }],
}

describe('buildChatQaPrompt', () => {
  it('含规则、材料各区块与问题', () => {
    const p = buildChatQaPrompt('我和张三聊过啥', [], ctx)
    expect(p).toContain('不要编造')
    expect(p).toContain('没找到')
    expect(p).toContain('年份2024')
    expect(p).toContain('与张三的聊天')
    expect(p).toContain('2024-03-01 张三：吃了')
    expect(p).toContain('我和张三聊过啥')
  })
  it('拼接多轮对话历史', () => {
    const history: ChatQaTurn[] = [
      { role: 'user', text: '张三是谁' },
      { role: 'assistant', text: '你的大学室友' },
    ]
    const p = buildChatQaPrompt('那他呢', history, ctx)
    expect(p).toContain('用户：张三是谁')
    expect(p).toContain('助理：你的大学室友')
  })
  it('空样本/空原文时不报错，仍含问题', () => {
    const p = buildChatQaPrompt('随便问', [], { statsSummary: '', samples: [], rawExcerpts: [] })
    expect(p).toContain('随便问')
  })
})

describe('parseChatQaAnswer', () => {
  it('trim 首尾空白', () => {
    expect(parseChatQaAnswer('  答案  \n')).toBe('答案')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/chatQa.test.ts`
Expected: FAIL —— `buildChatQaPrompt`/`parseChatQaAnswer` 未定义。

- [ ] **Step 3: 写实现**

在 `packages/core/src/ai/chatQa.ts` 末尾追加：

```ts
/** 把「统计概况 + 原文/样本 + 近几轮对话 + 本轮问题」拼成一次性 prompt。 */
export function buildChatQaPrompt(
  question: string,
  history: ChatQaTurn[],
  context: ChatQaContext,
): string {
  const parts: string[] = [
    '你是用户的微信聊天记录助理。请只依据下面提供的「聊天材料」回答用户的问题。',
    '规则：',
    '1. 只用材料里的信息作答，不要编造、不要臆测材料里没有的事实。',
    '2. 如果材料里找不到答案，直接说「我在你的聊天记录/样本里没找到相关内容」，不要硬答。',
    '3. 用中文、口语化地回答，可以引用聊天里的原话。',
    '',
  ]
  if (context.statsSummary) parts.push('【统计概况】', context.statsSummary, '')
  if (context.rawExcerpts.length) {
    parts.push('【相关聊天记录】')
    for (const ex of context.rawExcerpts) {
      parts.push(`— 与${ex.friend}的聊天：`)
      for (const line of ex.lines) parts.push(line)
      parts.push('')
    }
  }
  if (context.samples.length) {
    parts.push('【聊天样本】')
    for (const s of context.samples) parts.push(s)
    parts.push('')
  }
  if (history.length) {
    parts.push('【最近对话】')
    for (const t of history) parts.push(`${t.role === 'user' ? '用户' : '助理'}：${t.text}`)
    parts.push('')
  }
  parts.push('【用户的问题】', question)
  return parts.join('\n')
}

/** 答案是自由文本，仅去首尾空白（保留函数以便日后加结构化解析）。 */
export function parseChatQaAnswer(text: string): string {
  return text.trim()
}
```

- [ ] **Step 4: 追加导出**

在 `packages/core/src/index.ts` 的 Task 1 那两行导出旁改为：

```ts
export {
  selectRelevantFriends, extractKeywords, buildChatQaPrompt, parseChatQaAnswer,
} from './ai/chatQa'
export type { ChatQaTurn, RawExcerpt, ChatQaContext, FriendRef } from './ai/chatQa'
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/chatQa.test.ts`
Expected: PASS。

- [ ] **Step 6: 构建 core（miniapp 经 dist 消费，必须构建）**

Run: `pnpm --filter @nianlun/core build`
Expected: 成功输出到 `dist/`（`dist/index.js`/`dist/index.d.ts` 含新导出）。

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/ai/chatQa.ts packages/core/src/ai/__tests__/chatQa.test.ts packages/core/src/index.ts packages/core/dist
git commit -m "feat(core): buildChatQaPrompt/parseChatQaAnswer 并构建 dist"
```

---

### Task 3: miniapp — 检索适配器 chatQaRetrieval

**Files:**
- Create: `packages/miniapp/src/adapters/chatQaRetrieval.ts`
- Create: `packages/miniapp/src/adapters/__tests__/chatQaRetrieval.test.ts`

**Interfaces:**
- Consumes: core 的 `selectRelevantFriends`、`extractKeywords`、`sessionIdFromFileName`、`parseFile`、类型 `Friend`/`ReportData`/`Conversation`/`Message`/`ChatQaContext`/`RawExcerpt`；`./rawStore` 的 `rawStore`、`./samples` 的 `samples`。
- Produces:
  - `interface ChatQaRetrievalDeps { rawStore?: { list(): { name: string; size: number }[]; read(name: string): string }; samples?: { gatherTopSamples(friends: Friend[], opts?: { maxFriends?: number; perFriend?: number; maxTotal?: number }): string[] } }`
  - `interface RetrieveResult { context: ChatQaContext; rawAvailable: boolean; wantedRaw: boolean }`
  - `interface ChatQaRetrieval { retrieve(question: string, friends: Friend[], report: ReportData | null): RetrieveResult }`
  - `makeChatQaRetrieval(deps?: ChatQaRetrievalDeps): ChatQaRetrieval`

- [ ] **Step 1: 写失败测试**

创建 `packages/miniapp/src/adapters/__tests__/chatQaRetrieval.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { makeChatQaRetrieval } from '../chatQaRetrieval'
import type { Friend, ReportData } from '@nianlun/core'

function friend(p: Partial<Friend> & { id: string; name: string }): Friend {
  return {
    alias: '', rel: '其他', role: '', firstContact: 0, lastContact: 0,
    msgCount: 10, sentRatio: 50, peakPeriod: '', maxStreak: 0,
    monthly: new Array(12).fill(0), hourly: new Array(24).fill(0),
    weekHour: new Array(168).fill(0), keywords: [], userEdited: {}, ...p,
  } as Friend
}

const zhangsan = friend({ id: 'wxid_a', name: '张三', msgCount: 100 })
const lisi = friend({ id: 'wxid_b', name: '李四', msgCount: 50 })
const report: ReportData = {
  year: 2024, totalMessages: 150, friendCount: 2, activeDays: 30,
  topContacts: [{ friendId: 'wxid_a', msgCount: 100 }], latestMessage: null,
  keywords: [], relationBreakdown: [{ rel: '挚友', percent: 100 }],
}

// welive JSONL 原文：单聊里 sender===sessionId 为对方，空为我
const zhangsanFile = [
  JSON.stringify({ create_time: 1709251200, local_type: 1, sender_username: 'wxid_a', message_content: '周末去吃火锅吧' }),
  JSON.stringify({ create_time: 1709251260, local_type: 1, sender_username: '', message_content: '好啊几点' }),
].join('\n')

function fakeRaw(files: Record<string, string>) {
  return {
    list: () => Object.keys(files).map((name) => ({ name, size: files[name].length })),
    read: (name: string) => files[name] ?? '',
  }
}
const fakeSamples = { gatherTopSamples: () => ['我：在吗', '对方：在'] }

describe('chatQaRetrieval', () => {
  it('点名好友 → 从 rawStore 读原文、重解析成可读行放进 rawExcerpts', () => {
    const r = makeChatQaRetrieval({
      rawStore: fakeRaw({ 'wxid_a_00000001.jsonl': zhangsanFile }),
      samples: fakeSamples,
    })
    const { context, rawAvailable, wantedRaw } = r.retrieve('我和张三上次聊啥了', [zhangsan, lisi], report)
    expect(rawAvailable).toBe(true)
    expect(wantedRaw).toBe(true)
    expect(context.rawExcerpts).toHaveLength(1)
    expect(context.rawExcerpts[0].friend).toBe('张三')
    const joined = context.rawExcerpts[0].lines.join('\n')
    expect(joined).toContain('火锅')
    expect(joined).toContain('张三：')
    expect(joined).toContain('我：')
    expect(context.samples).toHaveLength(0)       // 命中原文时不再塞样本
    expect(context.statsSummary).toContain('2024')
  })

  it('泛问（未点名）→ 走样本 + 统计，rawExcerpts 为空', () => {
    const r = makeChatQaRetrieval({
      rawStore: fakeRaw({ 'wxid_a_00000001.jsonl': zhangsanFile }),
      samples: fakeSamples,
    })
    const { context, wantedRaw } = r.retrieve('我今年过得怎么样', [zhangsan, lisi], report)
    expect(wantedRaw).toBe(false)
    expect(context.rawExcerpts).toHaveLength(0)
    expect(context.samples.length).toBeGreaterThan(0)
  })

  it('rawStore 为空但点了名 → rawAvailable=false、wantedRaw=true、退回样本', () => {
    const r = makeChatQaRetrieval({ rawStore: fakeRaw({}), samples: fakeSamples })
    const { context, rawAvailable, wantedRaw } = r.retrieve('张三说过啥', [zhangsan], report)
    expect(rawAvailable).toBe(false)
    expect(wantedRaw).toBe(true)
    expect(context.rawExcerpts).toHaveLength(0)
    expect(context.samples.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/chatQaRetrieval.test.ts`
Expected: FAIL —— 找不到 `../chatQaRetrieval`。

- [ ] **Step 3: 写实现**

创建 `packages/miniapp/src/adapters/chatQaRetrieval.ts`：

```ts
import {
  selectRelevantFriends, extractKeywords, sessionIdFromFileName, parseFile,
} from '@nianlun/core'
import type { Friend, ReportData, ChatQaContext, RawExcerpt } from '@nianlun/core'
import { rawStore as defaultRawStore } from './rawStore'
import { samples as defaultSamples } from './samples'

export interface ChatQaRetrievalDeps {
  rawStore?: { list(): { name: string; size: number }[]; read(name: string): string }
  samples?: { gatherTopSamples(friends: Friend[], opts?: { maxFriends?: number; perFriend?: number; maxTotal?: number }): string[] }
}
export interface RetrieveResult { context: ChatQaContext; rawAvailable: boolean; wantedRaw: boolean }
export interface ChatQaRetrieval {
  retrieve(question: string, friends: Friend[], report: ReportData | null): RetrieveResult
}

const MAX_CHARS_PER_FRIEND = 4000     // 每位好友原文喂给 AI 的字符上限，防爆 token
const MAX_RAW_LINES = 120             // 每位好友最多取的行数

const fmtDate = (ts: number) => (ts ? new Date(ts).toISOString().slice(0, 10) : '')

function buildStatsSummary(friends: Friend[], report: ReportData | null): string {
  if (!report) return ''
  const nameById = new Map(friends.map((f) => [f.id, f.alias || f.name]))
  const top = report.topContacts.slice(0, 5)
    .map((c, i) => `${i + 1}.${nameById.get(c.friendId) ?? c.friendId}（${c.msgCount}条）`).join('，')
  const rel = report.relationBreakdown.filter((r) => r.percent > 0)
    .map((r) => `${r.rel}${r.percent}%`).join('，')
  return [
    `年份${report.year}；好友${report.friendCount}位；全年消息${report.totalMessages}条；活跃${report.activeDays}天。`,
    top ? `聊得最多：${top}。` : '',
    rel ? `关系分布：${rel}。` : '',
  ].filter(Boolean).join('\n')
}

/** 从末尾往前累计，保留最近的行直到字符预算用尽（返回时恢复时间正序）。 */
function capChars(lines: string[], budget: number): string[] {
  const out: string[] = []
  let used = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    used += lines[i].length + 1
    if (used > budget) break
    out.unshift(lines[i])
  }
  return out
}

export function makeChatQaRetrieval(deps: ChatQaRetrievalDeps = {}): ChatQaRetrieval {
  const rawStore = deps.rawStore ?? defaultRawStore
  const samples = deps.samples ?? defaultSamples

  return {
    retrieve(question, friends, report) {
      const statsSummary = buildStatsSummary(friends, report)
      const files = rawStore.list()
      const rawAvailable = files.length > 0
      const ids = selectRelevantFriends(question, friends)
      const wantedRaw = ids.length > 0
      const nameById = new Map(friends.map((f) => [f.id, f.alias || f.name]))
      const rawExcerpts: RawExcerpt[] = []

      if (rawAvailable && wantedRaw) {
        const keywords = extractKeywords(question, ids.map((id) => nameById.get(id) ?? ''))
        for (const id of ids) {
          const fileNames = files
            .filter((f) => sessionIdFromFileName(f.name) === id)
            .map((f) => f.name)
          const lines: string[] = []
          for (const name of fileNames) {
            const content = rawStore.read(name)
            if (!content) continue
            const parsed = parseFile(name, content)      // 原文重解析成可读消息
            for (const conv of parsed.conversations) {
              for (const m of conv.messages) {
                if (m.type !== 'text' || !m.text) continue
                const who = m.from === 'me' ? '我' : (nameById.get(id) ?? '对方')
                lines.push(`${fmtDate(m.ts)} ${who}：${m.text}`)
              }
            }
          }
          if (!lines.length) continue
          const matched = keywords.length ? lines.filter((l) => keywords.some((k) => l.includes(k))) : []
          const picked = (matched.length ? matched : lines).slice(-MAX_RAW_LINES)
          rawExcerpts.push({ friend: nameById.get(id) ?? id, lines: capChars(picked, MAX_CHARS_PER_FRIEND) })
        }
      }

      // 没捞到原文（泛问、或 rawStore 空/无匹配行）→ 退回样本
      const sampleLines = rawExcerpts.length === 0
        ? samples.gatherTopSamples(friends, { maxFriends: 12, perFriend: 5, maxTotal: 80 })
        : []

      return { context: { statsSummary, samples: sampleLines, rawExcerpts }, rawAvailable, wantedRaw }
    },
  }
}

export const chatQaRetrieval: ChatQaRetrieval = makeChatQaRetrieval()
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/chatQaRetrieval.test.ts`
Expected: PASS（3 个用例通过）。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/chatQaRetrieval.ts packages/miniapp/src/adapters/__tests__/chatQaRetrieval.test.ts
git commit -m "feat(miniapp): 聊天问答检索适配器 chatQaRetrieval"
```

---

### Task 4: miniapp — aiClient.answerChatQa

**Files:**
- Modify: `packages/miniapp/src/adapters/aiClient.ts`
- Modify: `packages/miniapp/src/adapters/__tests__/aiClient.test.ts`

**Interfaces:**
- Consumes: core 的 `buildChatQaPrompt`、`parseChatQaAnswer`、类型 `ChatQaTurn`/`ChatQaContext`；现有 `Transport`。
- Produces: `aiClient.answerChatQa(question: string, history: ChatQaTurn[], context: ChatQaContext): Promise<string>`。

- [ ] **Step 1: 写失败测试**

在 `packages/miniapp/src/adapters/__tests__/aiClient.test.ts` 的 `describe('aiClient', …)` 内追加：

```ts
  it('answerChatQa 把 prompt 交给 transport、回传 trim 后文本', async () => {
    const transport = vi.fn().mockResolvedValue('  你和张三聊了火锅。  ')
    const ctx = { statsSummary: '年份2024', samples: [], rawExcerpts: [{ friend: '张三', lines: ['2024-03-01 张三：吃火锅'] }] }
    const out = await makeAiClient(transport).answerChatQa('聊了啥', [], ctx as any)
    expect(out).toBe('你和张三聊了火锅。')                 // 已 trim
    expect(transport.mock.calls[0][0]).toContain('张三')   // prompt 含原文
    expect(transport.mock.calls[0][1]).toBe(2048)          // maxTokens
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/aiClient.test.ts`
Expected: FAIL —— `answerChatQa` 不是函数。

- [ ] **Step 3: 写实现**

在 `packages/miniapp/src/adapters/aiClient.ts`：

顶部 import 段落里，把 core 值导入追加 `buildChatQaPrompt, parseChatQaAnswer`，类型导入追加 `ChatQaTurn, ChatQaContext`：

```ts
import {
  buildReportCopyPrompt, buildFriendSuggestionPrompt, parseFriendSuggestion,
  buildFriendSentimentPrompt, buildYearSentimentPrompt, parseSentiment,
  buildFriendProfilePrompt, parseFriendProfile,
  buildMbtiPrompt, parseMbti,
  buildAstroPrompt, parseAstroReading, buildBirthExtractPrompt, parseBirthInfo,
  buildStockExtractionPrompt, parseStockExtraction,
  buildChatQaPrompt, parseChatQaAnswer,
} from '@nianlun/core'
import type {
  Friend, ReportData, FriendSuggestion, Sentiment, FriendProfile, MbtiResult,
  BaziChart, DayFortune, Compatibility, AstroReading, BirthInfo,
  StockPick, ExtractCtx,
  ChatQaTurn, ChatQaContext,
} from '@nianlun/core'
```

在 `makeAiClient` 返回对象里 `extractStocks` 之后追加一个方法：

```ts
    async answerChatQa(question: string, history: ChatQaTurn[], context: ChatQaContext): Promise<string> {
      const text = await transport(buildChatQaPrompt(question, history, context), 2048)
      return parseChatQaAnswer(text)
    },
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/aiClient.test.ts`
Expected: PASS（含新用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/aiClient.ts packages/miniapp/src/adapters/__tests__/aiClient.test.ts
git commit -m "feat(miniapp): aiClient.answerChatQa 走 chatQa prompt"
```

---

### Task 5: miniapp — Pinia store chatQa

**Files:**
- Create: `packages/miniapp/src/stores/chatQa.ts`
- Create: `packages/miniapp/src/stores/__tests__/chatQa.test.ts`

**Interfaces:**
- Consumes: `./data` 的 `createDataStore`；`../adapters/aiClient` 的 `aiClient`；`../adapters/chatQaRetrieval` 的 `makeChatQaRetrieval`/`ChatQaRetrieval`；类型 `ChatQaTurn`/`ChatQaContext`。
- Produces:
  - `createChatQaStore(deps?): ` 返回 `defineStore('chatQa', …)`，暴露 `{ messages: ChatQaTurn[]; loading: boolean; error: string; ask(question: string): Promise<void>; clear(): void }`。
  - 默认导出 `useChatQaStore`。
  - `Deps = { useData?: ReturnType<typeof createDataStore>; retrieval?: ChatQaRetrieval; answer?: (q, history, ctx) => Promise<string> }`

- [ ] **Step 1: 写失败测试**

创建 `packages/miniapp/src/stores/__tests__/chatQa.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createChatQaStore } from '../chatQa'
import { createDataStore } from '../data'
import type { ChatQaContext } from '@nianlun/core'

// 内存 storage/rawStore，喂给 data store，避免碰 wx
const memStorage = { loadFriends: () => [], loadReport: () => null } as any
const memRaw = {} as any

const emptyCtx: ChatQaContext = { statsSummary: '', samples: [], rawExcerpts: [] }

function setup(opts: {
  answer?: (...a: any[]) => Promise<string>
  retrieve?: (...a: any[]) => { context: ChatQaContext; rawAvailable: boolean; wantedRaw: boolean }
} = {}) {
  const useData = createDataStore(memStorage, memRaw)
  const retrieval = { retrieve: opts.retrieve ?? (() => ({ context: emptyCtx, rawAvailable: true, wantedRaw: false })) }
  const answer = opts.answer ?? (async () => '答案')
  return createChatQaStore({ useData, retrieval, answer })()
}

describe('chatQa store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('ask 追加用户轮和助理轮', async () => {
    const store = setup({ answer: async () => '你和张三聊了火锅。' })
    await store.ask('聊了啥')
    expect(store.messages).toEqual([
      { role: 'user', text: '聊了啥' },
      { role: 'assistant', text: '你和张三聊了火锅。' },
    ])
    expect(store.loading).toBe(false)
  })

  it('空问题不发起', async () => {
    const answer = vi.fn(async () => 'x')
    const store = setup({ answer })
    await store.ask('   ')
    expect(answer).not.toHaveBeenCalled()
    expect(store.messages).toHaveLength(0)
  })

  it('多轮：第二问把前面对话作为 history 传给 answer', async () => {
    const seen: any[] = []
    const answer = async (_q: string, history: any[]) => { seen.push(history); return 'ok' }
    const store = setup({ answer })
    await store.ask('张三是谁')
    await store.ask('那他呢')
    // 第二次调用的 history 含第一轮问答（不含刚追加的本轮问题）
    expect(seen[1].map((t: any) => t.text)).toEqual(['张三是谁', 'ok'])
  })

  it('点名但本机无原文 → 答案追加降级提示', async () => {
    const store = setup({
      answer: async () => '（基于样本）',
      retrieve: () => ({ context: emptyCtx, rawAvailable: false, wantedRaw: true }),
    })
    await store.ask('张三说过啥')
    expect(store.messages[1].text).toContain('原始聊天记录')
  })

  it('answer 抛错 → 记 error 并追加出错助理轮', async () => {
    const store = setup({ answer: async () => { throw new Error('网络炸了') } })
    await store.ask('在吗')
    expect(store.error).toBe('网络炸了')
    expect(store.messages[1].text).toContain('网络炸了')
    expect(store.loading).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/chatQa.test.ts`
Expected: FAIL —— 找不到 `../chatQa`。

- [ ] **Step 3: 写实现**

创建 `packages/miniapp/src/stores/chatQa.ts`：

```ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ChatQaTurn, ChatQaContext } from '@nianlun/core'
import { useDataStore as defaultUseData, createDataStore } from './data'
import { aiClient } from '../adapters/aiClient'
import { makeChatQaRetrieval, type ChatQaRetrieval } from '../adapters/chatQaRetrieval'

type AnswerFn = (question: string, history: ChatQaTurn[], context: ChatQaContext) => Promise<string>
type Deps = {
  useData?: ReturnType<typeof createDataStore>
  retrieval?: ChatQaRetrieval
  answer?: AnswerFn
}

const HISTORY_TURNS = 6      // 每轮最多带 6 条历史进 prompt，控制 token
const DEGRADE_HINT = '（提示：本机没有原始聊天记录，具体聊天内容需在原设备、或重新导入原文后才能查。）'

export function createChatQaStore(deps: Deps = {}) {
  const useData = deps.useData ?? defaultUseData
  const retrieval = deps.retrieval ?? makeChatQaRetrieval()
  const answer: AnswerFn = deps.answer ?? aiClient.answerChatQa

  return defineStore('chatQa', () => {
    const messages = ref<ChatQaTurn[]>([])
    const loading = ref(false)
    const error = ref('')

    async function ask(question: string): Promise<void> {
      const q = question.trim()
      if (!q || loading.value) return
      error.value = ''
      messages.value = [...messages.value, { role: 'user', text: q }]
      loading.value = true
      try {
        const d = useData()
        const { context, rawAvailable, wantedRaw } = retrieval.retrieve(q, d.friends, d.report)
        // 历史取本轮问题之前的最近 HISTORY_TURNS 条
        const history = messages.value.slice(0, -1).slice(-HISTORY_TURNS)
        let text = await answer(q, history, context)
        if (wantedRaw && !rawAvailable) text += `\n\n${DEGRADE_HINT}`
        messages.value = [...messages.value, { role: 'assistant', text }]
      } catch (e) {
        error.value = (e as Error)?.message ?? String(e)
        messages.value = [...messages.value, { role: 'assistant', text: `出错了：${error.value}` }]
      } finally {
        loading.value = false
      }
    }

    function clear() { messages.value = []; error.value = '' }

    return { messages, loading, error, ask, clear }
  })
}

export const useChatQaStore = createChatQaStore()
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/chatQa.test.ts`
Expected: PASS（5 个用例通过）。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/stores/chatQa.ts packages/miniapp/src/stores/__tests__/chatQa.test.ts
git commit -m "feat(miniapp): chatQa store 编排检索+AI+多轮"
```

---

### Task 6: miniapp — chat-qa 页面 + 路由注册 + 概览入口

**Files:**
- Create: `packages/miniapp/src/pages/chat-qa/chat-qa.vue`
- Modify: `packages/miniapp/src/pages.json`（注册页面）
- Modify: `packages/miniapp/src/pages/overview/overview.vue`（加入口按钮 + 跳转）

**Interfaces:**
- Consumes: `../../stores/chatQa` 的 `useChatQaStore`。
- Produces: 可从概览页 `uni.navigateTo` 进入的问答页 `/pages/chat-qa/chat-qa`。

- [ ] **Step 1: 注册路由**

在 `packages/miniapp/src/pages.json` 的 `"pages"` 数组末尾（`report` 那项之后）加一项（注意前一项补逗号）：

```json
    { "path": "pages/report/report", "style": { "navigationBarTitleText": "年度报告" } },
    { "path": "pages/chat-qa/chat-qa", "style": { "navigationBarTitleText": "问聊天记录" } }
```

（不加进 `tabBar`，作为二级页从概览进入。）

- [ ] **Step 2: 写页面**

创建 `packages/miniapp/src/pages/chat-qa/chat-qa.vue`：

```vue
<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useChatQaStore } from '../../stores/chatQa'

const store = useChatQaStore()
const draft = ref('')
const scrollTop = ref(0)

const EXAMPLES = ['我今年跟谁聊得最多？', '我的聊天风格是什么样的？', '谁最近约我吃饭？']

async function send() {
  const q = draft.value.trim()
  if (!q || store.loading) return
  draft.value = ''
  await store.ask(q)
  await nextTick()
  scrollTop.value += 100000      // 触发滚到底
}
function useExample(q: string) { draft.value = q }
</script>

<template>
  <view class="page">
    <scroll-view class="feed" scroll-y :scroll-top="scrollTop" scroll-with-animation>
      <view v-if="store.messages.length === 0" class="intro">
        <view class="intro-icon">💬</view>
        <text class="intro-t">问问你的微信聊天记录</text>
        <text class="intro-s">具体的事、聊天规律、关系，都能问。答不出会直说，不瞎编。</text>
        <view class="examples">
          <text v-for="q in EXAMPLES" :key="q" class="ex" @click="useExample(q)">{{ q }}</text>
        </view>
      </view>

      <view
        v-for="(m, i) in store.messages" :key="i"
        :class="['bubble-row', m.role === 'user' ? 'me' : 'ai']"
      >
        <text class="bubble">{{ m.text }}</text>
      </view>

      <view v-if="store.loading" class="bubble-row ai">
        <text class="bubble typing">思考中…</text>
      </view>
    </scroll-view>

    <view class="composer">
      <input
        class="input" v-model="draft" placeholder="问点什么…"
        confirm-type="send" @confirm="send"
      />
      <view :class="['send', (!draft.trim() || store.loading) && 'disabled']" @click="send">发送</view>
    </view>
  </view>
</template>

<style scoped>
.page { display: flex; flex-direction: column; height: 100vh; background: var(--bg); }
.feed { flex: 1; padding: 24rpx 24rpx 12rpx; box-sizing: border-box; }
.intro { padding: 80rpx 40rpx; text-align: center; }
.intro-icon { font-size: 72rpx; }
.intro-t { display: block; margin-top: 16rpx; font-size: 32rpx; font-weight: 700; color: var(--fg); }
.intro-s { display: block; margin-top: 12rpx; font-size: 24rpx; color: var(--muted); line-height: 1.6; }
.examples { margin-top: 32rpx; display: flex; flex-direction: column; gap: 16rpx; }
.ex { padding: 18rpx 24rpx; font-size: 26rpx; color: var(--accent); background: var(--surface); border: 1rpx solid var(--border); border-radius: 16rpx; }
.bubble-row { display: flex; margin: 14rpx 0; }
.bubble-row.me { justify-content: flex-end; }
.bubble-row.ai { justify-content: flex-start; }
.bubble { max-width: 78%; padding: 18rpx 24rpx; font-size: 27rpx; line-height: 1.6; border-radius: 20rpx; white-space: pre-wrap; word-break: break-word; }
.me .bubble { background: var(--accent); color: #fff; border-bottom-right-radius: 6rpx; }
.ai .bubble { background: var(--surface); color: var(--fg); border: 1rpx solid var(--border); border-bottom-left-radius: 6rpx; }
.typing { color: var(--muted); }
.composer { display: flex; align-items: center; gap: 16rpx; padding: 16rpx 24rpx calc(16rpx + env(safe-area-inset-bottom)); background: var(--surface); border-top: 1rpx solid var(--border); }
.input { flex: 1; height: 72rpx; padding: 0 24rpx; font-size: 27rpx; color: var(--fg); background: var(--bg); border: 1rpx solid var(--border-2); border-radius: 999rpx; }
.send { padding: 0 32rpx; height: 72rpx; display: flex; align-items: center; border-radius: 999rpx; background: var(--accent); color: #fff; font-size: 27rpx; font-weight: 600; }
.send.disabled { opacity: 0.45; }
</style>
```

- [ ] **Step 3: 概览页加入口**

在 `packages/miniapp/src/pages/overview/overview.vue` 的 `<script setup>` 里加一个跳转函数（放在其它函数附近，如 `onRestore` 之后）：

```ts
function goChatQa() {
  uni.navigateTo({ url: '/pages/chat-qa/chat-qa' })
}
```

在 `<template>` 里，`<view class="head">…</view>`（概览标题那块，约第 88–94 行）之后、`<view class="stats">` 之前插入一个入口卡片：

```html
      <view class="card qa-entry" @click="goChatQa">
        <text class="qa-emoji">💬</text>
        <view class="qa-mid">
          <text class="qa-t">问问我的聊天记录</text>
          <text class="qa-s">具体的事、规律、关系都能问</text>
        </view>
        <text class="qa-arrow">›</text>
      </view>
```

在该文件 `<style scoped>` 末尾追加样式：

```css
.qa-entry { display: flex; align-items: center; gap: 20rpx; padding: 26rpx 28rpx; margin-bottom: 20rpx; }
.qa-emoji { font-size: 44rpx; }
.qa-mid { flex: 1; display: flex; flex-direction: column; }
.qa-t { font-size: 28rpx; font-weight: 700; color: var(--fg); }
.qa-s { margin-top: 6rpx; font-size: 23rpx; color: var(--muted); }
.qa-arrow { font-size: 40rpx; color: var(--muted); }
```

- [ ] **Step 4: 跑全量测试确认无回归**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: PASS（新旧测试全绿；页面为渲染层，无新单测，靠既有 smoke 测试兜底）。

- [ ] **Step 5: 类型检查（页面 TS 正确性）**

Run: `pnpm --filter @nianlun/miniapp exec vue-tsc --noEmit`
Expected: 无类型错误。（若项目未配置该命令，改跑 `pnpm --filter @nianlun/miniapp build` 做等价校验。）

- [ ] **Step 6: 提交**

```bash
git add packages/miniapp/src/pages/chat-qa/chat-qa.vue packages/miniapp/src/pages.json packages/miniapp/src/pages/overview/overview.vue
git commit -m "feat(miniapp): 聊天记录问答页 + 概览入口 + 路由注册"
```

---

## 收尾验证（全部任务完成后）

- [ ] Run: `pnpm -r test` —— 整仓测试全绿。
- [ ] 真机/开发者工具冒烟：概览页点「问问我的聊天记录」进入问答页；导入过数据后，问一个点名问题（如「我和某某聊过啥」）验证走原文，问一个泛问（如「我今年跟谁聊得最多」）验证走样本+统计；未导入原文的设备验证降级提示出现。

## 自审记录（对照 spec）

- 组件 1 core chatQa（selectRelevantFriends/extractKeywords/buildChatQaPrompt/parseChatQaAnswer/类型）→ Task 1、2。
- 组件 2 chatQaRetrieval（点名读原文/泛问样本/字符上限/空降级）→ Task 3。
- 组件 3 aiClient.answerChatQa → Task 4。
- 组件 4 store chatQa（ask 编排/多轮 history/内存不落盘/降级提示/错误处理）→ Task 5。
- 组件 5 页面 + pages.json + 概览入口 → Task 6。
- 隐私与降级：只发裁剪片段（Task 3 上限）、rawStore 空提示（Task 5）、对话仅内存（Task 5 无持久化）→ 覆盖。
- 测试矩阵：core 纯函数、retrieval 三路径、aiClient、store 五用例 → 覆盖。
- 类型一致性：`ChatQaContext`/`ChatQaTurn`/`RawExcerpt` 跨任务同名同形；retrieve 返回 `{ context, rawAvailable, wantedRaw }` 与 store 消费一致；`answerChatQa` 签名 core↔aiClient↔store 三处一致。
```
