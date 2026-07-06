# 好友情绪价值分析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在好友详情页新增「我 vs TA」双栏情绪分析 —— 情绪价值分布（环形图 + 平均情绪值）、情绪波动双线折线、高频词按极性染色，全部由本地情感词典在导入时对全部消息逐条打分聚合得出。

**Architecture:** 情绪打分是 core 里的纯函数（`stats/emotion.ts`），在 `aggregate` 遍历消息时对每条 `scoreMessage`，按 `from:'me'|'them'` 两侧聚合成 `Friend.emotion`；只把聚合结果随 `Friend[]` 落盘，原始聊天照旧不落盘。miniapp 在 `lib/insights.ts` 加纯映射函数（环形弧段、双线坐标），好友详情页用 canvas 渲染。

**Tech Stack:** TypeScript（core 纯库，`lib:["ES2020"]` 无 DOM）、Vue 3 + uni-app（小程序）、Vitest（jsdom）。pnpm workspace monorepo。

## Global Constraints

- pnpm workspace，命令用 `pnpm --filter @nianlun/core ...` / `pnpm --filter @nianlun/miniapp ...`，不用 npm/yarn。
- 单向依赖 `miniapp → core`；**core 绝不 import window/document/vue/IndexedDB**，只吃普通数据、吐普通数据。
- `Relation` 类型从 `@nianlun/core` import，绝不重定义。时间戳是毫秒 `number`。
- 隐私：情绪聚合结果可落盘，**原始聊天 `Conversation[]` 绝不落盘**。
- TDD：先写失败测试 → 跑红 → 最小实现 → 跑绿 → 提交。频繁提交。
- 情绪值 `avg` 统一 0..1，0.5=中性；`raw` 净分无固定范围；`polarity` -1..1。
- 词典误判风险 → 页面统一标「本地词典估算，仅供参考」。

---

## File Structure

- `packages/core/src/model/types.ts` — 修改：新增 `EmotionDist`/`MonthMood`/`FriendEmotion`，`Friend` 加 `emotion?`。
- `packages/core/src/stats/emotion.ts` — 新建：词典 + 打分 + 聚合/合并辅助。
- `packages/core/src/stats/aggregate.ts` — 修改：遍历消息时打分，产出 `Friend.emotion`。
- `packages/core/src/merge/merge.ts` — 修改：`mergeFriends` 合并 `emotion`。
- `packages/core/src/index.ts` — 修改：导出新类型与函数。
- `packages/miniapp/src/lib/insights.ts` — 修改：新增 `donutSegments`/`moodDualLinePoints`。
- `packages/miniapp/src/pages/friend-detail/friend-detail.vue` — 修改：两张新卡 + 词云染色。
- 各自 `__tests__/` — 对应测试。

---

## Task 1: Core 情感打分（词典 + scoreMessage/classify/toValue）

**Files:**
- Modify: `packages/core/src/model/types.ts`
- Create: `packages/core/src/stats/emotion.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/stats/__tests__/emotion.test.ts`

**Interfaces:**
- Produces:
  - `scoreMessage(text: string): number` — 消息原始净分。
  - `classify(raw: number): '开心' | '平淡' | '难过'`
  - `toValue(raw: number): number` — 归一到 0..1。
  - `wordPolarity(word: string): number` — 词极性 -1..1，不在词典为 0。
  - 类型 `EmotionDist`、`MonthMood`、`FriendEmotion`；`Friend.emotion?: FriendEmotion`。

- [ ] **Step 1: 在 types.ts 加类型**

在 `packages/core/src/model/types.ts` 的 `Friend` 定义前加：

```ts
export interface EmotionDist {
  happy: number      // 开心 条数
  neutral: number    // 平淡 条数
  sad: number        // 难过 条数
  total: number
  avg: number        // 平均情绪值 0..1，0.5=中性
}

export interface MonthMood {
  avg: number        // 该月该侧平均情绪值 0..1
  count: number      // 该月该侧消息条数（>0）
}

export interface FriendEmotion {
  me: EmotionDist
  them: EmotionDist
  monthly: { me: (MonthMood | null)[]; them: (MonthMood | null)[] }  // 长度 12，无消息月 = null
  words: Array<{ word: string; count: number; polarity: number }>    // polarity -1..1，不在词典=0
}
```

在 `Friend` 接口末尾（`userEdited` 之后）加一行：

```ts
  emotion?: FriendEmotion
```

- [ ] **Step 2: 写失败测试**

创建 `packages/core/src/stats/__tests__/emotion.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { scoreMessage, classify, toValue, wordPolarity } from '../emotion'

describe('scoreMessage', () => {
  it('正面词得正分', () => {
    expect(scoreMessage('今天好开心谢谢你')).toBeGreaterThan(0)
  })
  it('负面词得负分', () => {
    expect(scoreMessage('好难受心情烦')).toBeLessThan(0)
  })
  it('正面 emoji 加正分', () => {
    expect(scoreMessage('😄')).toBeGreaterThan(0)
    expect(scoreMessage('😭')).toBeLessThan(0)
  })
  it('哈哈哈算正、呜呜呜算负', () => {
    expect(scoreMessage('哈哈哈哈')).toBeGreaterThan(0)
    expect(scoreMessage('呜呜呜')).toBeLessThan(0)
  })
  it('否定词翻转极性：不开心 → 负', () => {
    expect(scoreMessage('我不开心')).toBeLessThan(0)
  })
  it('感叹号放大同号强度', () => {
    expect(Math.abs(scoreMessage('太棒了！！！'))).toBeGreaterThan(Math.abs(scoreMessage('太棒了')))
  })
  it('空串/纯符号得 0，永不抛异常', () => {
    expect(scoreMessage('')).toBe(0)
    expect(scoreMessage('。。。')).toBe(0)
  })
})

describe('classify', () => {
  it('按 ±0.5 阈值分三档', () => {
    expect(classify(1)).toBe('开心')
    expect(classify(-1)).toBe('难过')
    expect(classify(0)).toBe('平淡')
    expect(classify(0.5)).toBe('平淡')   // 边界不含
  })
})

describe('toValue', () => {
  it('中性 raw=0 → 0.5', () => {
    expect(toValue(0)).toBeCloseTo(0.5)
  })
  it('强正 → 趋近 1，强负 → 趋近 0，且落在 [0,1]', () => {
    expect(toValue(10)).toBeCloseTo(1)
    expect(toValue(-10)).toBeCloseTo(0)
    expect(toValue(3)).toBeGreaterThan(0.5)
    expect(toValue(-3)).toBeLessThan(0.5)
  })
})

describe('wordPolarity', () => {
  it('正词>0、负词<0、未收录=0', () => {
    expect(wordPolarity('开心')).toBeGreaterThan(0)
    expect(wordPolarity('难受')).toBeLessThan(0)
    expect(wordPolarity('桌子')).toBe(0)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/stats/__tests__/emotion.test.ts`
Expected: FAIL（`../emotion` 不存在）

- [ ] **Step 4: 实现 emotion.ts**

创建 `packages/core/src/stats/emotion.ts`：

```ts
// 本地「聊天体」中文情感打分：纯函数，无副作用，永不抛异常。
// 词典为精简口语词表，可持续扩充；普通情绪 ±1，强烈 ±2。

const POS_STRONG = ['爱你', '爱', '太棒了', '幸福', '开心死', '感动', '喜欢你', '超喜欢', '么么', '抱抱', '想你']
const POS = ['开心', '喜欢', '谢谢', '哈哈', '嘻嘻', '嘿嘿', '棒', '好耶', '不错', '赞', '可爱', '甜', '暖', '舒服', '满足', '期待', '好的', '好呀', '嗯嗯', '晚安', '辛苦了', '加油', '放心']
const NEG_STRONG = ['难受', '崩溃', '讨厌', '滚', '恶心', '绝望', '心碎', '痛苦', '委屈', '想哭', '烦死']
const NEG = ['烦', '无聊', '累', '唉', '呜', '生气', '郁闷', '失望', '难过', '伤心', 'emmm', '算了', '无语', '尴尬', '担心', '害怕', '孤独', '别烦', '不想']

const LEX: Record<string, number> = {}
for (const w of POS_STRONG) LEX[w] = 2
for (const w of POS) LEX[w] = 1
for (const w of NEG_STRONG) LEX[w] = -2
for (const w of NEG) LEX[w] = -1

const EMOJI: Record<string, number> = {
  '😄': 1, '😀': 1, '😁': 1, '🥰': 2, '😍': 2, '❤️': 2, '💕': 2, '😂': 1, '🤣': 1, '😊': 1, '👍': 1, '🎉': 1, '😘': 2,
  '😭': -2, '😡': -2, '💔': -2, '😔': -1, '😞': -1, '😢': -1, '😰': -1, '😩': -1, '🙁': -1, '😖': -1,
}

const NEG_WORDS = ['不', '没', '别', '无', '非', '莫']

// 词典权重 → 极性 -1..1（供词云染色）。
export function wordPolarity(word: string): number {
  const w = LEX[word]
  if (!w) return 0
  return Math.max(-1, Math.min(1, w / 2))
}

/** 消息原始净分（可正可负，无固定范围）。空串/纯符号 → 0。 */
export function scoreMessage(text: string): number {
  if (!text) return 0
  let score = 0

  // 情绪词（含否定翻转：词首前 2 字窗口内有否定词则取反）
  for (const word in LEX) {
    let idx = text.indexOf(word)
    while (idx !== -1) {
      const window = text.slice(Math.max(0, idx - 2), idx)
      const negated = NEG_WORDS.some((n) => window.includes(n))
      score += negated ? -LEX[word] : LEX[word]
      idx = text.indexOf(word, idx + word.length)
    }
  }

  // emoji
  for (const e in EMOJI) {
    let idx = text.indexOf(e)
    while (idx !== -1) { score += EMOJI[e]; idx = text.indexOf(e, idx + e.length) }
  }

  // 重复启发式：哈{2,}/嘻嘻/嘿嘿 → +1；呜{2,}/emmm → -1
  if (/哈哈+|嘻嘻|嘿嘿/.test(text)) score += 1
  if (/呜呜+|em+/i.test(text)) score -= 1

  // 感叹号放大同号强度（每个 !/！ ×1.2，封顶 ×2）
  const bangs = (text.match(/[!！]/g) || []).length
  if (bangs > 0 && score !== 0) {
    score *= Math.min(2, 1 + bangs * 0.2)
  }

  return score
}

export function classify(raw: number): '开心' | '平淡' | '难过' {
  if (raw > 0.5) return '开心'
  if (raw < -0.5) return '难过'
  return '平淡'
}

const R = 3
export function toValue(raw: number): number {
  const clamped = Math.max(-R, Math.min(R, raw))
  return 0.5 + clamped / (2 * R)
}
```

- [ ] **Step 5: 在 index.ts 导出**

在 `packages/core/src/index.ts` 加：

```ts
export { scoreMessage, classify, toValue, wordPolarity } from './stats/emotion'
export type { EmotionDist, MonthMood, FriendEmotion } from './model/types'
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/stats/__tests__/emotion.test.ts`
Expected: PASS（全部绿）

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/stats/emotion.ts packages/core/src/model/types.ts packages/core/src/index.ts packages/core/src/stats/__tests__/emotion.test.ts
git commit -m "feat(core): 情感打分词典与 scoreMessage/classify/toValue"
```

---

## Task 2: Core 聚合/合并辅助（DistAcc + mergeDist/mergeMood + mergeEmotion）

**Files:**
- Modify: `packages/core/src/stats/emotion.ts`
- Test: `packages/core/src/stats/__tests__/emotion.test.ts`

**Interfaces:**
- Consumes: `scoreMessage`/`classify`/`toValue`/`wordPolarity`（Task 1）；类型 `EmotionDist`/`MonthMood`/`FriendEmotion`。
- Produces:
  - `interface DistAcc { happy; neutral; sad; total; valueSum }`
  - `emptyAcc(): DistAcc`
  - `addToAcc(acc: DistAcc, raw: number): void`
  - `finalizeAcc(acc: DistAcc): EmotionDist`
  - `accToMood(acc: DistAcc): MonthMood | null`
  - `mergeDist(a: EmotionDist, b: EmotionDist): EmotionDist`
  - `mergeMood(a: MonthMood | null, b: MonthMood | null): MonthMood | null`
  - `mergeEmotion(a: FriendEmotion, b: FriendEmotion, keywords: Array<{word;count}>): FriendEmotion`

- [ ] **Step 1: 写失败测试（追加到 emotion.test.ts）**

在 `packages/core/src/stats/__tests__/emotion.test.ts` 顶部 import 补上，并追加：

```ts
import {
  emptyAcc, addToAcc, finalizeAcc, accToMood, mergeDist, mergeMood, mergeEmotion,
} from '../emotion'
import type { EmotionDist, FriendEmotion } from '../../model/types'

describe('DistAcc 聚合', () => {
  it('累加后 finalize：计数分档 + avg 为各条 value 均值', () => {
    const acc = emptyAcc()
    addToAcc(acc, 2)    // 开心
    addToAcc(acc, 0)    // 平淡
    addToAcc(acc, -2)   // 难过
    const d = finalizeAcc(acc)
    expect(d).toMatchObject({ happy: 1, neutral: 1, sad: 1, total: 3 })
    expect(d.avg).toBeCloseTo(0.5)   // 对称 → 0.5
  })
  it('空 acc → total 0、avg 0.5', () => {
    expect(finalizeAcc(emptyAcc())).toMatchObject({ total: 0, avg: 0.5 })
  })
  it('accToMood：空返回 null，非空返回 {avg,count}', () => {
    expect(accToMood(emptyAcc())).toBeNull()
    const acc = emptyAcc(); addToAcc(acc, 2)
    expect(accToMood(acc)).toMatchObject({ count: 1 })
  })
})

describe('mergeDist / mergeMood', () => {
  it('mergeDist：计数相加、avg 按 total 加权', () => {
    const a: EmotionDist = { happy: 2, neutral: 0, sad: 0, total: 2, avg: 1 }
    const b: EmotionDist = { happy: 0, neutral: 0, sad: 2, total: 2, avg: 0 }
    const m = mergeDist(a, b)
    expect(m).toMatchObject({ happy: 2, sad: 2, total: 4 })
    expect(m.avg).toBeCloseTo(0.5)
  })
  it('mergeMood：一侧 null 取另一侧；都在则条数加权', () => {
    expect(mergeMood(null, { avg: 0.8, count: 3 })).toMatchObject({ avg: 0.8, count: 3 })
    expect(mergeMood({ avg: 1, count: 1 }, { avg: 0, count: 3 })!.avg).toBeCloseTo(0.25)
    expect(mergeMood(null, null)).toBeNull()
  })
})

describe('mergeEmotion', () => {
  it('me/them 合并、monthly 逐月合并、words 用新 keywords 重算极性', () => {
    const mk = (avg: number): FriendEmotion => ({
      me: { happy: 1, neutral: 0, sad: 0, total: 1, avg },
      them: { happy: 0, neutral: 1, sad: 0, total: 1, avg: 0.5 },
      monthly: { me: [{ avg, count: 1 }, ...Array(11).fill(null)], them: Array(12).fill(null) },
      words: [],
    })
    const merged = mergeEmotion(mk(1), mk(0), [{ word: '开心', count: 5 }, { word: '桌子', count: 2 }])
    expect(merged.me.total).toBe(2)
    expect(merged.me.avg).toBeCloseTo(0.5)
    expect(merged.monthly.me[0]).toMatchObject({ count: 2 })
    expect(merged.words.find((w) => w.word === '开心')!.polarity).toBeGreaterThan(0)
    expect(merged.words.find((w) => w.word === '桌子')!.polarity).toBe(0)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/stats/__tests__/emotion.test.ts`
Expected: FAIL（`emptyAcc` 等未定义）

- [ ] **Step 3: 实现（追加到 emotion.ts）**

在 `packages/core/src/stats/emotion.ts` 追加，并补 import 类型：

```ts
import type { EmotionDist, MonthMood, FriendEmotion } from '../model/types'

export interface DistAcc { happy: number; neutral: number; sad: number; total: number; valueSum: number }

export function emptyAcc(): DistAcc {
  return { happy: 0, neutral: 0, sad: 0, total: 0, valueSum: 0 }
}

export function addToAcc(acc: DistAcc, raw: number): void {
  const c = classify(raw)
  if (c === '开心') acc.happy++
  else if (c === '难过') acc.sad++
  else acc.neutral++
  acc.total++
  acc.valueSum += toValue(raw)
}

export function finalizeAcc(acc: DistAcc): EmotionDist {
  return {
    happy: acc.happy, neutral: acc.neutral, sad: acc.sad, total: acc.total,
    avg: acc.total === 0 ? 0.5 : acc.valueSum / acc.total,
  }
}

export function accToMood(acc: DistAcc): MonthMood | null {
  if (acc.total === 0) return null
  return { avg: acc.valueSum / acc.total, count: acc.total }
}

export function mergeDist(a: EmotionDist, b: EmotionDist): EmotionDist {
  const total = a.total + b.total
  return {
    happy: a.happy + b.happy, neutral: a.neutral + b.neutral, sad: a.sad + b.sad, total,
    avg: total === 0 ? 0.5 : (a.avg * a.total + b.avg * b.total) / total,
  }
}

export function mergeMood(a: MonthMood | null, b: MonthMood | null): MonthMood | null {
  if (!a) return b
  if (!b) return a
  const count = a.count + b.count
  return { avg: (a.avg * a.count + b.avg * b.count) / count, count }
}

export function mergeEmotion(
  a: FriendEmotion, b: FriendEmotion, keywords: Array<{ word: string; count: number }>,
): FriendEmotion {
  return {
    me: mergeDist(a.me, b.me),
    them: mergeDist(a.them, b.them),
    monthly: {
      me: a.monthly.me.map((m, i) => mergeMood(m, b.monthly.me[i])),
      them: a.monthly.them.map((m, i) => mergeMood(m, b.monthly.them[i])),
    },
    words: keywords.map((k) => ({ word: k.word, count: k.count, polarity: wordPolarity(k.word) })),
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/stats/__tests__/emotion.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/stats/emotion.ts packages/core/src/stats/__tests__/emotion.test.ts
git commit -m "feat(core): 情绪聚合/合并辅助 DistAcc 与 mergeEmotion"
```

---

## Task 3: aggregate 集成 —— 产出 Friend.emotion

**Files:**
- Modify: `packages/core/src/stats/aggregate.ts`
- Test: `packages/core/src/stats/__tests__/aggregate.test.ts`

**Interfaces:**
- Consumes: `scoreMessage`/`emptyAcc`/`addToAcc`/`finalizeAcc`/`accToMood`/`wordPolarity`（Task 1、2）。
- Produces: `aggregate` 输出的每个 `Friend` 带 `emotion: FriendEmotion`（我/TA 两侧分布 + 逐月 + 词极性）。

- [ ] **Step 1: 写失败测试（追加到 aggregate.test.ts）**

在 `packages/core/src/stats/__tests__/aggregate.test.ts` 追加（若无该文件则新建并 import `aggregate`）：

```ts
import { describe, it, expect } from 'vitest'
import { aggregate } from '../aggregate'
import type { Conversation } from '../../model/types'

function conv(messages: Conversation['messages']): Conversation {
  return { id: 'A', peerName: 'A', isGroup: false, messages }
}
const ts = (month: number) => new Date(2026, month - 1, 15, 12).getTime() // month 1..12

describe('aggregate emotion', () => {
  it('按 me/them 两侧聚合分布', () => {
    const [f] = aggregate([conv([
      { ts: ts(1), from: 'me', type: 'text', text: '好开心哈哈' },
      { ts: ts(1), from: 'them', type: 'text', text: '好难受烦' },
      { ts: ts(1), from: 'them', type: 'text', text: '在吗' },
    ])])
    expect(f.emotion!.me.happy).toBe(1)
    expect(f.emotion!.them.sad).toBe(1)
    expect(f.emotion!.them.total).toBe(2)
  })

  it('monthly 无消息月为 null、有消息月带 count', () => {
    const [f] = aggregate([conv([
      { ts: ts(3), from: 'me', type: 'text', text: '开心' },
    ])])
    expect(f.emotion!.monthly.me[0]).toBeNull()      // 1 月无
    expect(f.emotion!.monthly.me[2]).toMatchObject({ count: 1 }) // 3 月有
  })

  it('words 带极性（高频正词>0）', () => {
    const msgs = Array.from({ length: 5 }, () => ({ ts: ts(1), from: 'me' as const, type: 'text' as const, text: '开心' }))
    const [f] = aggregate([conv(msgs)])
    const w = f.emotion!.words.find((x) => x.word === '开心')
    expect(w && w.polarity).toBeGreaterThan(0)
  })

  it('无消息好友：emotion 两侧 total 0、avg 0.5、monthly 全 null', () => {
    const [f] = aggregate([conv([])])
    expect(f.emotion!.me.total).toBe(0)
    expect(f.emotion!.me.avg).toBeCloseTo(0.5)
    expect(f.emotion!.monthly.me.every((m) => m === null)).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/stats/__tests__/aggregate.test.ts`
Expected: FAIL（`f.emotion` 为 undefined）

- [ ] **Step 3: 改 aggregate.ts**

在 `packages/core/src/stats/aggregate.ts` 顶部加 import：

```ts
import { scoreMessage, emptyAcc, addToAcc, finalizeAcc, accToMood, wordPolarity } from './emotion'
import type { DistAcc } from './emotion'
```

在 `aggregate` 的 `map` 回调里，`createFriend` 之后、消息遍历之前，建累加器：

```ts
    const meAcc = emptyAcc()
    const themAcc = emptyAcc()
    const meMonth: DistAcc[] = Array.from({ length: 12 }, emptyAcc)
    const themMonth: DistAcc[] = Array.from({ length: 12 }, emptyAcc)
```

在消息遍历循环体内（`for (const m of msgs)`）追加打分（只对有正文的消息打分，其余按中性计入 0 分以保证条数完整；这里选择：只对 `m.text` 存在的消息打分，图片占位等按中性 0）：

```ts
      const raw = scoreMessage(m.text ?? '')
      const acc = m.from === 'me' ? meAcc : themAcc
      addToAcc(acc, raw)
      if (m.ts) {
        const mo = new Date(m.ts).getMonth()
        addToAcc(m.from === 'me' ? meMonth[mo] : themMonth[mo], raw)
      }
```

在 `return f` 之前，组装 emotion：

```ts
    f.emotion = {
      me: finalizeAcc(meAcc),
      them: finalizeAcc(themAcc),
      monthly: {
        me: meMonth.map(accToMood),
        them: themMonth.map(accToMood),
      },
      words: f.keywords.map((k) => ({ word: k.word, count: k.count, polarity: wordPolarity(k.word) })),
    }
```

注意：`msgs.length === 0` 时函数在赋值前就 `return f`（第 38 行左右），此时无 emotion。为满足「无消息好友也有 emotion」测试，把该早退分支改为在 return 前补空 emotion：

```ts
    if (msgs.length === 0) {
      f.emotion = {
        me: finalizeAcc(emptyAcc()), them: finalizeAcc(emptyAcc()),
        monthly: { me: Array(12).fill(null), them: Array(12).fill(null) },
        words: [],
      }
      return f
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/stats/__tests__/aggregate.test.ts`
Expected: PASS

- [ ] **Step 5: 跑全部 core 测试确保无回归**

Run: `pnpm --filter @nianlun/core test`
Expected: PASS（含既有 aggregate 用例）

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/stats/aggregate.ts packages/core/src/stats/__tests__/aggregate.test.ts
git commit -m "feat(core): aggregate 逐条打分产出 Friend.emotion"
```

---

## Task 4: merge 集成 —— mergeFriends 合并 emotion

**Files:**
- Modify: `packages/core/src/merge/merge.ts`
- Test: `packages/core/src/merge/__tests__/merge.test.ts`

**Interfaces:**
- Consumes: `mergeEmotion`（Task 2）；`Friend.emotion`。
- Produces: `mergeFriends` 对同 id 好友合并 `emotion`（都在则 `mergeEmotion`，仅一侧则取该侧）。

- [ ] **Step 1: 写失败测试（追加到 merge.test.ts）**

在 `packages/core/src/merge/__tests__/merge.test.ts` 追加（import `mergeFriends`、`createFriend`）：

```ts
import { createFriend } from '../../model/friend'
import type { FriendEmotion } from '../../model/types'

const emo = (total: number): FriendEmotion => ({
  me: { happy: total, neutral: 0, sad: 0, total, avg: 1 },
  them: { happy: 0, neutral: 0, sad: 0, total: 0, avg: 0.5 },
  monthly: { me: [{ avg: 1, count: total }, ...Array(11).fill(null)], them: Array(12).fill(null) },
  words: [{ word: '开心', count: total, polarity: 1 }],
})

describe('mergeFriends emotion', () => {
  it('同 id 两侧都有 emotion → 计数相加', () => {
    const a = { ...createFriend('X', 'X'), emotion: emo(2), keywords: [{ word: '开心', count: 5 }] }
    const b = { ...createFriend('X', 'X'), emotion: emo(3), keywords: [{ word: '开心', count: 5 }] }
    const { friends } = mergeFriends([a], [b])
    expect(friends[0].emotion!.me.total).toBe(5)
    expect(friends[0].emotion!.monthly.me[0]!.count).toBe(5)
  })
  it('仅 incoming 有 emotion → 取 incoming', () => {
    const a = createFriend('Y', 'Y')                       // 无 emotion
    const b = { ...createFriend('Y', 'Y'), emotion: emo(2) }
    const { friends } = mergeFriends([a], [b])
    expect(friends[0].emotion!.me.total).toBe(2)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/merge/__tests__/merge.test.ts`
Expected: FAIL（合并后 emotion 未相加）

- [ ] **Step 3: 改 merge.ts**

在 `packages/core/src/merge/merge.ts` 顶部加 import：

```ts
import { mergeEmotion } from '../stats/emotion'
```

在 `mergeFriends` 的 `incoming.forEach` 里、`merged.userEdited = ...` 之后、`byId.set(...)` 之前加：

```ts
    if (old.emotion && inc.emotion) {
      merged.emotion = mergeEmotion(old.emotion, inc.emotion, merged.keywords)
    } else {
      merged.emotion = inc.emotion ?? old.emotion
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/merge/__tests__/merge.test.ts`
Expected: PASS

- [ ] **Step 5: 跑全部 core 测试 + 构建（web/miniapp 依赖 dist）**

Run: `pnpm --filter @nianlun/core test && pnpm --filter @nianlun/core build`
Expected: PASS + 构建成功

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/merge/merge.ts packages/core/src/merge/__tests__/merge.test.ts
git commit -m "feat(core): mergeFriends 合并好友 emotion"
```

---

## Task 5: miniapp 绘图纯函数（donutSegments + moodDualLinePoints）

**Files:**
- Modify: `packages/miniapp/src/lib/insights.ts`
- Test: `packages/miniapp/src/lib/__tests__/insights.test.ts`

**Interfaces:**
- Consumes: `EmotionDist`、`FriendEmotion`（`@nianlun/core`）。
- Produces:
  - `donutSegments(dist: EmotionDist): DonutSeg[]`，`DonutSeg { label; value; frac; color; start; end }`（角度弧度，起点 -π/2，顺时针）。
  - `moodDualLinePoints(monthly, opts): DualLine`，`opts { width; height; pad }`，`DualLine { me: Pt[]; them: Pt[]; hasData: boolean }`，`Pt { x; y; m }`（m=月份 0..11；null 月不产点）。

- [ ] **Step 1: 写失败测试（追加到 insights.test.ts）**

在 `packages/miniapp/src/lib/__tests__/insights.test.ts` 追加：

```ts
import { donutSegments, moodDualLinePoints } from '../insights'
import type { EmotionDist, FriendEmotion } from '@nianlun/core'

describe('donutSegments', () => {
  it('total=0 返回空', () => {
    expect(donutSegments({ happy: 0, neutral: 0, sad: 0, total: 0, avg: 0.5 })).toEqual([])
  })
  it('三段 frac 之和为 1、角度覆盖 2π、含三种颜色', () => {
    const d: EmotionDist = { happy: 2, neutral: 1, sad: 1, total: 4, avg: 0.6 }
    const segs = donutSegments(d)
    expect(segs).toHaveLength(3)
    expect(segs.reduce((s, x) => s + x.frac, 0)).toBeCloseTo(1)
    expect(segs[segs.length - 1].end - segs[0].start).toBeCloseTo(Math.PI * 2)
    expect(new Set(segs.map((s) => s.color)).size).toBe(3)
  })
  it('占比为 0 的档也保留但 frac=0', () => {
    const segs = donutSegments({ happy: 4, neutral: 0, sad: 0, total: 4, avg: 1 })
    expect(segs.find((s) => s.label === '难过')!.frac).toBe(0)
  })
})

describe('moodDualLinePoints', () => {
  const mk = (me: (number | null)[]): FriendEmotion['monthly'] => ({
    me: me.map((v) => (v === null ? null : { avg: v, count: 1 })),
    them: Array(12).fill(null),
  })
  const opts = { width: 300, height: 150, pad: 20 }

  it('全 null → hasData false、无点', () => {
    const r = moodDualLinePoints(mk(Array(12).fill(null)), opts)
    expect(r.hasData).toBe(false)
    expect(r.me).toHaveLength(0)
  })
  it('部分月有值 → 只产非 null 月的点，带月份 m', () => {
    const arr = Array(12).fill(null); arr[0] = 1; arr[5] = 0
    const r = moodDualLinePoints(mk(arr), opts)
    expect(r.hasData).toBe(true)
    expect(r.me.map((p) => p.m)).toEqual([0, 5])
    // avg=1 → 顶部(y 最小)，avg=0 → 底部(y 最大)
    expect(r.me[0].y).toBeLessThan(r.me[1].y)
    // x 随月份递增
    expect(r.me[0].x).toBeLessThan(r.me[1].x)
  })
  it('avg=0.5 → y 居中', () => {
    const arr = Array(12).fill(null); arr[6] = 0.5
    const r = moodDualLinePoints(mk(arr), opts)
    expect(r.me[0].y).toBeCloseTo(opts.height / 2)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/lib/__tests__/insights.test.ts`
Expected: FAIL（`donutSegments` 未定义）

- [ ] **Step 3: 实现（追加到 insights.ts）**

在 `packages/miniapp/src/lib/insights.ts` 追加（并在顶部 import 补类型）：

```ts
import type { EmotionDist, FriendEmotion } from '@nianlun/core'

export interface DonutSeg {
  label: '开心' | '平淡' | '难过'
  value: number
  frac: number
  color: string
  start: number   // 弧度，起点 -π/2
  end: number
}

const EMO_COLOR = { 开心: '#e8a04b', 平淡: '#b8bcc4', 难过: '#5a8fd0' } as const

/** 情绪价值分布 → 三色环形弧段。total=0 返回空。角度从 -π/2 顺时针累加。 */
export function donutSegments(dist: EmotionDist): DonutSeg[] {
  if (dist.total === 0) return []
  const parts: Array<{ label: DonutSeg['label']; value: number }> = [
    { label: '开心', value: dist.happy },
    { label: '平淡', value: dist.neutral },
    { label: '难过', value: dist.sad },
  ]
  let angle = -Math.PI / 2
  return parts.map((p) => {
    const frac = p.value / dist.total
    const start = angle
    const end = angle + frac * Math.PI * 2
    angle = end
    return { label: p.label, value: p.value, frac, color: EMO_COLOR[p.label], start, end }
  })
}

export interface MoodPt { x: number; y: number; m: number }
export interface DualLine { me: MoodPt[]; them: MoodPt[]; hasData: boolean }

/**
 * 逐月情绪(0..1) → 双线坐标。null 月不产点（页面只连相邻月 → 断开处不连线）。
 * y：avg=1 顶部(pad)，avg=0 底部(height-pad)，0.5 居中。
 */
export function moodDualLinePoints(
  monthly: FriendEmotion['monthly'],
  opts: { width: number; height: number; pad: number },
): DualLine {
  const { width, height, pad } = opts
  const toPts = (arr: (FriendEmotion['monthly']['me'][number])[]): MoodPt[] => {
    const pts: MoodPt[] = []
    arr.forEach((mm, m) => {
      if (!mm) return
      const x = pad + (m / 11) * (width - 2 * pad)
      const y = height - pad - mm.avg * (height - 2 * pad)
      pts.push({ x, y, m })
    })
    return pts
  }
  const me = toPts(monthly.me)
  const them = toPts(monthly.them)
  return { me, them, hasData: me.length > 0 || them.length > 0 }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/lib/__tests__/insights.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/lib/insights.ts packages/miniapp/src/lib/__tests__/insights.test.ts
git commit -m "feat(miniapp): 情绪环形/双线折线绘图纯函数"
```

---

## Task 6: 好友详情页 UI（情绪价值分布卡 + 情绪波动卡 + 词云染色）

**Files:**
- Modify: `packages/miniapp/src/pages/friend-detail/friend-detail.vue`

**Interfaces:**
- Consumes: `friend.emotion`（Task 3）；`donutSegments`/`moodDualLinePoints`（Task 5）。
- Produces: 无对外接口，页面渲染。

**说明：** 页面 canvas 用 `uni.createCanvasContext(id)` 绘制（参考 `report.vue` 的 `poster` canvas）。小程序需在 `onReady`/数据就绪后绘制。此任务无独立单元测试，靠 core/insights 的纯函数测试 + 真机验证。

- [ ] **Step 1: script 引入绘图函数与绘制逻辑**

在 `packages/miniapp/src/pages/friend-detail/friend-detail.vue` `<script setup>` 的 import 行补上：

```ts
import { donutSegments, moodDualLinePoints } from '../../lib/insights'
import { onReady } from '@dcloudio/uni-app'
```

加计算属性与绘制函数（放在 `friend` computed 之后）：

```ts
const emotion = computed(() => friend.value?.emotion ?? null)
const meDonut = computed(() => (emotion.value ? donutSegments(emotion.value.me) : []))
const themDonut = computed(() => (emotion.value ? donutSegments(emotion.value.them) : []))
const hasMood = computed(() => !!emotion.value && moodDualLinePoints(
  emotion.value.monthly, { width: 300, height: 150, pad: 20 }).hasData)

const pct = (n: number, total: number) => (total === 0 ? 0 : Math.round((n / total) * 100))

function drawDonut(id: string, segs: ReturnType<typeof donutSegments>) {
  const ctx = uni.createCanvasContext(id)
  const cx = 60, cy = 60, r = 46, lw = 22
  ctx.setLineWidth(lw)
  if (segs.length === 0) {
    ctx.beginPath(); ctx.setStrokeStyle('#e5e7eb')
    ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
  } else {
    for (const s of segs) {
      if (s.frac === 0) continue
      ctx.beginPath(); ctx.setStrokeStyle(s.color)
      ctx.arc(cx, cy, r, s.start, s.end); ctx.stroke()
    }
  }
  ctx.draw()
}

function drawMood() {
  if (!emotion.value) return
  const W = 300, H = 150, pad = 20
  const dl = moodDualLinePoints(emotion.value.monthly, { width: W, height: H, pad })
  const ctx = uni.createCanvasContext('moodLine')
  // 0.5 中线
  const midY = H - pad - 0.5 * (H - 2 * pad)
  ctx.beginPath(); ctx.setStrokeStyle('#e5e7eb'); ctx.setLineWidth(1)
  ctx.moveTo(pad, midY); ctx.lineTo(W - pad, midY); ctx.stroke()
  // 只连相邻月（m 差 1），断开处不连线
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
}

function drawEmotion() {
  if (!emotion.value) return
  drawDonut('donutMe', meDonut.value)
  drawDonut('donutThem', themDonut.value)
  if (hasMood.value) drawMood()
}

onReady(() => { setTimeout(drawEmotion, 50) }) // 等布局
```

同时在 `friend` 数据可能异步就绪时补一次绘制：在 `onLoad` 回调末尾或 `friend` 变化后调用。最简单做法 —— 在 `onLoad` 里 `id.value = ...` 之后加 `setTimeout(drawEmotion, 120)`。

- [ ] **Step 2: template 加两张卡（放在「高频词」卡之后、编辑卡之前）**

在 `packages/miniapp/src/pages/friend-detail/friend-detail.vue` 的高频词 `<view v-if="words.length" ...>` 卡之后插入：

```html
      <view v-if="emotion" class="card block">
        <text class="block-t">情绪价值分布</text>
        <view class="emo-donuts">
          <view class="emo-col">
            <canvas canvas-id="donutMe" class="donut"></canvas>
            <text class="emo-side">我</text>
            <text class="emo-avg">平均情绪值 {{ emotion.me.avg.toFixed(2) }}</text>
            <text class="emo-break">开心 {{ pct(emotion.me.happy, emotion.me.total) }}% · 平淡 {{ pct(emotion.me.neutral, emotion.me.total) }}% · 难过 {{ pct(emotion.me.sad, emotion.me.total) }}%</text>
          </view>
          <view class="emo-col">
            <canvas canvas-id="donutThem" class="donut"></canvas>
            <text class="emo-side">TA</text>
            <text class="emo-avg">平均情绪值 {{ emotion.them.avg.toFixed(2) }}</text>
            <text class="emo-break">开心 {{ pct(emotion.them.happy, emotion.them.total) }}% · 平淡 {{ pct(emotion.them.neutral, emotion.them.total) }}% · 难过 {{ pct(emotion.them.sad, emotion.them.total) }}%</text>
          </view>
        </view>
        <view class="emo-legend">
          <text class="lg"><text class="dot" style="background:#e8a04b"></text>开心</text>
          <text class="lg"><text class="dot" style="background:#b8bcc4"></text>平淡</text>
          <text class="lg"><text class="dot" style="background:#5a8fd0"></text>难过</text>
        </view>
        <text class="senti-note faint">本地词典估算，仅供参考</text>
      </view>

      <view v-if="emotion" class="card block">
        <text class="block-t">情绪波动</text>
        <template v-if="hasMood">
          <view class="mood-legend">
            <text class="lg"><text class="dot" style="background:#e8a04b"></text>我</text>
            <text class="lg"><text class="dot" style="background:#5a8fd0"></text>TA</text>
          </view>
          <canvas canvas-id="moodLine" class="mood-canvas"></canvas>
          <text class="senti-note faint">本地词典估算，仅供参考</text>
        </template>
        <text v-else class="faint mood-empty">样本不足，暂无法生成情绪走势</text>
      </view>
```

- [ ] **Step 3: 词云染色（改造现有高频词卡）**

把现有高频词 `<text class="word" ...>` 的绑定改为按极性上色。先在 script 加：

```ts
const wordColor = (word: string): string => {
  const w = emotion.value?.words.find((x) => x.word === word)
  const p = w ? w.polarity : 0
  if (p > 0.15) return '#e8a04b'
  if (p < -0.15) return '#5a8fd0'
  return '#9aa0aa'
}
```

再把词云那段模板的 `:style` 改成（保留字号/透明度，加 color）：

```html
          <text
            v-for="w in words" :key="w.word"
            class="word"
            :style="{ fontSize: FONT[w.tier] + 'rpx', opacity: OPACITY[w.tier], color: wordColor(w.word) }"
          >{{ w.word }}</text>
```

（`.word` 原有 `color: var(--accent-strong)` 会被 inline style 覆盖。）

- [ ] **Step 4: 加样式**

在 `<style scoped>` 末尾加：

```css
.emo-donuts { display: flex; gap: 24rpx; margin-top: 24rpx; }
.emo-col { flex: 1; display: flex; flex-direction: column; align-items: center; }
.donut { width: 120rpx; height: 120rpx; }
.emo-side { margin-top: 8rpx; font-size: 26rpx; font-weight: 600; color: var(--fg); }
.emo-avg { margin-top: 6rpx; font-size: 23rpx; color: var(--accent-strong); }
.emo-break { margin-top: 4rpx; font-size: 21rpx; color: var(--muted); text-align: center; line-height: 1.5; }
.emo-legend, .mood-legend { display: flex; gap: 24rpx; justify-content: center; margin-top: 20rpx; }
.lg { display: flex; align-items: center; font-size: 22rpx; color: var(--muted); }
.dot { display: inline-block; width: 16rpx; height: 16rpx; border-radius: 999rpx; margin-right: 8rpx; }
.mood-canvas { width: 100%; height: 300rpx; margin-top: 12rpx; }
.mood-empty { display: block; margin-top: 24rpx; font-size: 24rpx; text-align: center; }
```

- [ ] **Step 5: 类型检查 + 构建**

Run: `pnpm --filter @nianlun/miniapp exec vue-tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 6: 真机/开发者工具验证**

- 导入含双向消息的聊天 → 进好友详情页。
- 断言：出现「情绪价值分布」卡（我/TA 两个环形图 + 平均情绪值 + 占比）、「情绪波动」卡（双线折线或「样本不足」）、高频词按极性染色（暖/冷/灰）。
- 老数据（无 emotion）→ 两张卡不出现，页面其余正常。

- [ ] **Step 7: 提交**

```bash
git add packages/miniapp/src/pages/friend-detail/friend-detail.vue
git commit -m "feat(miniapp): 好友详情页情绪价值分布/波动/词云染色"
```

---

## Self-Review 记录

- **Spec 覆盖**：情绪价值分布（Task 3 聚合 + Task 5 donutSegments + Task 6 卡）✓；情绪波动（Task 3 monthly + Task 5 moodDualLinePoints + Task 6 canvas）✓；词语情感倾向（Task 1 wordPolarity + Task 3 words + Task 6 染色）✓；混合（图表本地、AI 保留现有按钮不动）✓；我 vs TA 双栏 ✓；隐私（聚合落盘、原始不落盘）✓；合并可复现（Task 4 mergeEmotion）✓。
- **占位扫描**：无 TBD/TODO；每个代码步骤含完整代码。
- **类型一致**：`EmotionDist`/`MonthMood`/`FriendEmotion`/`DistAcc` 跨任务签名一致；`donutSegments`/`moodDualLinePoints` 的 `DonutSeg`/`DualLine`/`MoodPt` 在 Task 5 定义、Task 6 消费一致；颜色常量（开心 #e8a04b / 平淡 #b8bcc4 / 难过 #5a8fd0，我暖/TA冷）全程一致。
