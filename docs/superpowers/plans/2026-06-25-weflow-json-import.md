# WeFlow JSON 导入 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `@nianlun/core` 新增一个解析器，把 WeFlow 导出的消息级 JSON 解析成 `Conversation[]`，复用既有 `aggregate → buildReport` 管线产出好友表与年度报告。

**Architecture:** 只动 `core`（web 零改动）。新增 `parsers/weflow.ts`，内部映射逻辑抽成纯函数 `mapWeflowMessages` 供未来 API 直连（B 阶段）复用；注册进 `pipeline/parseFile.ts`。字段名用**候选 key 数组**防御式读取，容忍 WeFlow 字段名差异；最后一步用真实导出校验。

**Tech Stack:** TypeScript（core，`lib: ES2020`、`types: []`，禁 DOM）、Vitest、pnpm workspace。

## Global Constraints

- 包管理用 **pnpm**，不用 npm/yarn。
- `core` 是纯函数库：**禁止** `window`/`document`/`IndexedDB`/`vue`/任何 DOM API；只用 ES2020 内置（`JSON.parse` 允许）。
- 解析器**容错**：坏数据收集进 `warnings`，**永不抛异常**。
- **不改动**现有 `txt.ts`/`html.ts`/`backup.ts` 解析器，只新增 + 注册。
- 本次只支持 **JSON**（不碰 WeFlow 的 CSV/TXT/Excel/PGSQL/ChatLab 格式）。
- 时间戳为毫秒级 `number`（`Message.ts`）。

## 假设的 WeFlow JSON 结构（最后一步用真实导出校验）

按微信经典字段做的**假设**。防御式候选 key 已覆盖常见大小写/命名变体；若真实导出字段名不在候选内，只需在 `weflow.ts` 顶部的 `F` 常量对应数组里补一个 key。

```json
{
  "talker": "wxid_test001",
  "nickName": "测试好友",
  "isChatroom": false,
  "messages": [
    { "createTime": 1704888000, "isSender": 0, "type": 1, "content": "在吗" },
    { "createTime": 1704888060, "isSender": 1, "type": 1, "content": "在的" }
  ]
}
```

- `createTime` 假设为 **Unix 秒**（`< 1e12` 则 ×1000 转毫秒）。
- `isSender`：`1` ⇒ 我方（`'me'`），否则 `'them'`。
- `type`：微信消息类型码（1=text、3=image、34=voice、43=video、10000/10002=system，其余=other）。
- 群聊：`isChatroom` 为真，或 `talker` 以 `@chatroom` 结尾。

## 文件结构

- 新增 `packages/core/src/parsers/weflow.ts` —— 纯函数 `mapWeflowMessages` + `weflowParser`（`Parser` 接口）。
- 新增 `packages/core/src/parsers/__tests__/weflow.test.ts` —— 单元测试。
- 新增 `packages/core/src/parsers/__tests__/fixtures/weflow-sample.json` —— 合成样本（结构同上，正文为假数据）。
- 修改 `packages/core/src/pipeline/parseFile.ts` —— 注册 `weflowParser`。

---

### Task 1: `mapWeflowMessages` 纯函数 + 合成 fixture

把 WeFlow JSON（已 `JSON.parse`）映射成 `Conversation[]`，含字段读取、时间戳/发送者/类型转换、容错。

**Files:**
- Create: `packages/core/src/parsers/weflow.ts`
- Create: `packages/core/src/parsers/__tests__/fixtures/weflow-sample.json`
- Test: `packages/core/src/parsers/__tests__/weflow.test.ts`

**Interfaces:**
- Consumes: `Conversation`、`Message`、`ParseWarning` from `../model/types`。
- Produces:
  - `mapWeflowMessages(raw: unknown): { conversations: Conversation[]; warnings: ParseWarning[] }`
  - 类型 `Message['type']` 取值：`'text' | 'image' | 'voice' | 'video' | 'system' | 'other'`。

- [ ] **Step 1: 写合成 fixture**

Create `packages/core/src/parsers/__tests__/fixtures/weflow-sample.json`:

```json
{
  "talker": "wxid_test001",
  "nickName": "测试好友",
  "isChatroom": false,
  "messages": [
    { "createTime": 1704888000, "isSender": 0, "type": 1, "content": "在吗" },
    { "createTime": 1704888060, "isSender": 1, "type": 1, "content": "在的" },
    { "createTime": 1704888120, "isSender": 0, "type": 3, "content": "" },
    { "createTime": 1704974400, "isSender": 1, "type": 34, "content": "" }
  ]
}
```

- [ ] **Step 2: 写失败测试**

Create `packages/core/src/parsers/__tests__/weflow.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mapWeflowMessages } from '../weflow'
import sample from './fixtures/weflow-sample.json'

describe('mapWeflowMessages', () => {
  it('maps a private conversation with id/peerName/isGroup', () => {
    const { conversations } = mapWeflowMessages(sample)
    expect(conversations).toHaveLength(1)
    const c = conversations[0]
    expect(c.id).toBe('wxid_test001')
    expect(c.peerName).toBe('测试好友')
    expect(c.isGroup).toBe(false)
    expect(c.messages).toHaveLength(4)
  })

  it('converts Unix seconds to milliseconds', () => {
    const { conversations } = mapWeflowMessages(sample)
    expect(conversations[0].messages[0].ts).toBe(1704888000 * 1000)
  })

  it('maps isSender to from', () => {
    const m = mapWeflowMessages(sample).conversations[0].messages
    expect(m[0].from).toBe('them')
    expect(m[1].from).toBe('me')
  })

  it('maps WeChat type codes', () => {
    const m = mapWeflowMessages(sample).conversations[0].messages
    expect(m[0].type).toBe('text')
    expect(m[2].type).toBe('image')
    expect(m[3].type).toBe('voice')
  })

  it('detects group chat by @chatroom talker', () => {
    const { conversations } = mapWeflowMessages({
      talker: '123@chatroom', nickName: '群', messages: [
        { createTime: 1704888000, isSender: 0, type: 1, content: 'hi' },
      ],
    })
    expect(conversations[0].isGroup).toBe(true)
  })

  it('skips a message with no valid timestamp and records a warning', () => {
    const res = mapWeflowMessages({
      talker: 'x', nickName: 'X', messages: [
        { isSender: 0, type: 1, content: '坏消息' },
        { createTime: 1704888000, isSender: 1, type: 1, content: '好消息' },
      ],
    })
    expect(res.conversations[0].messages).toHaveLength(1)
    expect(res.warnings).toHaveLength(1)
  })

  it('returns empty + warning when messages array is missing', () => {
    const res = mapWeflowMessages({ talker: 'x', nickName: 'X' })
    expect(res.conversations).toHaveLength(0)
    expect(res.warnings).toHaveLength(1)
  })
})
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/parsers/__tests__/weflow.test.ts`
Expected: FAIL —— `mapWeflowMessages` is not defined / 模块不存在。

> 注：`weflow.test.ts` import 了 `.json`，core 的 vitest 默认支持 JSON import；若报 TS 类型错，确保 `tsconfig` 的 `resolveJsonModule` 已开（vitest 运行期不受其影响）。

- [ ] **Step 4: 写实现**

Create `packages/core/src/parsers/weflow.ts`:

```ts
import type { Conversation, Message, ParseWarning } from '../model/types'

// 候选字段名（用真实 WeFlow 导出校验；缺失的真名补进对应数组即可）
const F = {
  messages: ['messages', 'msgList', 'data'],
  ts: ['createTime', 'CreateTime', 'create_time', 'timestamp'],
  isSender: ['isSender', 'IsSender', 'is_sender', 'isSelf'],
  type: ['type', 'Type', 'msgType', 'MsgType'],
  text: ['content', 'StrContent', 'msg', 'message'],
  talker: ['talker', 'wxid', 'userName', 'UserName'],
  peerName: ['nickName', 'nickname', 'talkerName', 'remark'],
  isGroup: ['isChatroom', 'isGroup', 'is_chatroom'],
}

// 微信消息类型码 → 年轮类型
const TYPE_MAP: Record<number, Message['type']> = {
  1: 'text', 3: 'image', 34: 'voice', 43: 'video',
  10000: 'system', 10002: 'system',
}

function pick(obj: Record<string, unknown> | undefined, keys: string[]): unknown {
  if (!obj || typeof obj !== 'object') return undefined
  for (const k of keys) {
    const v = obj[k]
    if (v !== undefined && v !== null) return v
  }
  return undefined
}

function toMs(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n < 1e12 ? n * 1000 : n // < 1e12 视为秒
}

function mapType(raw: unknown): Message['type'] {
  return TYPE_MAP[Number(raw)] ?? 'other'
}

export function mapWeflowMessages(
  raw: unknown,
): { conversations: Conversation[]; warnings: ParseWarning[] } {
  const warnings: ParseWarning[] = []
  const obj = raw as Record<string, unknown>
  const rawMsgs = pick(obj, F.messages)
  if (!Array.isArray(rawMsgs)) {
    return { conversations: [], warnings: [{ reason: '未找到消息数组' }] }
  }

  const talker = String(pick(obj, F.talker) ?? '') || 'unknown'
  const peerName = String(pick(obj, F.peerName) ?? '') || '未知联系人'
  const isGroup = Boolean(pick(obj, F.isGroup)) || talker.endsWith('@chatroom')

  const messages: Message[] = []
  rawMsgs.forEach((rm, i) => {
    const r = rm as Record<string, unknown>
    const ts = toMs(pick(r, F.ts))
    if (!ts) {
      warnings.push({ line: i + 1, reason: '消息缺少有效时间,已跳过' })
      return
    }
    const from: Message['from'] = Number(pick(r, F.isSender)) === 1 ? 'me' : 'them'
    messages.push({ ts, from, type: mapType(pick(r, F.type)), text: String(pick(r, F.text) ?? '') })
  })

  const conv: Conversation = { id: talker, peerName, isGroup, messages }
  return { conversations: messages.length ? [conv] : [], warnings }
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/parsers/__tests__/weflow.test.ts`
Expected: PASS（7 个测试全绿）。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/parsers/weflow.ts packages/core/src/parsers/__tests__/weflow.test.ts packages/core/src/parsers/__tests__/fixtures/weflow-sample.json
git commit -m "feat(core): add mapWeflowMessages for WeFlow JSON"
```

---

### Task 2: `weflowParser`（`canParse` + `parse`）

把纯函数包成 `Parser`：`canParse` 靠内容签名消歧（不误吃年轮自家 JSON 备份），`parse` 包 `JSON.parse` 容错。

**Files:**
- Modify: `packages/core/src/parsers/weflow.ts`
- Test: `packages/core/src/parsers/__tests__/weflow.test.ts`

**Interfaces:**
- Consumes: `mapWeflowMessages`（Task 1）、`Parser`/`ParseResult` from `../model/types`。
- Produces: `export const weflowParser: Parser`（`name: 'weflow'`）。

- [ ] **Step 1: 追加失败测试**

Append to `packages/core/src/parsers/__tests__/weflow.test.ts`:

```ts
import { weflowParser } from '../weflow'

describe('weflowParser.canParse', () => {
  const weflowSample = JSON.stringify({
    talker: 'wxid_1', nickName: '甲',
    messages: [{ createTime: 1704888000, isSender: 0, type: 1, content: 'hi' }],
  })

  it('accepts a WeFlow message JSON', () => {
    expect(weflowParser.canParse('chat.json', weflowSample)).toBe(true)
  })

  it('rejects nianlun friend-backup JSON (array of friends)', () => {
    const backup = JSON.stringify([{ name: '张三', rel: '同事', msgCount: 10 }])
    expect(weflowParser.canParse('好友信息.json', backup)).toBe(false)
  })

  it('rejects txt chat-log content', () => {
    expect(weflowParser.canParse('chat.txt', '2025-01-10 20:00:00 妈妈\n吃了吗')).toBe(false)
  })
})

describe('weflowParser.parse', () => {
  it('returns empty + warning on invalid JSON, never throws', () => {
    const res = weflowParser.parse('{ not json ')
    expect(res.conversations).toHaveLength(0)
    expect(res.warnings.length).toBeGreaterThan(0)
  })

  it('parses valid WeFlow JSON into conversations', () => {
    const content = JSON.stringify({
      talker: 'wxid_1', nickName: '甲',
      messages: [{ createTime: 1704888000, isSender: 1, type: 1, content: 'hi' }],
    })
    const res = weflowParser.parse(content)
    expect(res.conversations[0].messages[0].from).toBe('me')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/parsers/__tests__/weflow.test.ts`
Expected: FAIL —— `weflowParser` is not defined。

- [ ] **Step 3: 追加实现**

Append to `packages/core/src/parsers/weflow.ts`（顶部 import 改为含 `Parser`/`ParseResult`）:

```ts
import type { Conversation, Message, ParseWarning, Parser, ParseResult } from '../model/types'
```

并在文件末尾追加:

```ts
export const weflowParser: Parser = {
  name: 'weflow',

  canParse(_fileName, sample) {
    // 不靠 .json 后缀(年轮自家备份也是 .json)。靠内容签名:
    // 顶层对象 { ... "messages": [...] } 且含消息级时间/发送者字段。
    const s = sample.replace(/^﻿/, '').trimStart()
    if (!s.startsWith('{')) return false // 好友备份是数组,以 '[' 开头
    const hasMsgArray = /"(messages|msgList|data)"\s*:\s*\[/.test(s)
    const hasMsgField = /"(createTime|CreateTime|isSender|IsSender)"/.test(s)
    return hasMsgArray && hasMsgField
  },

  parse(content, onProgress): ParseResult {
    let raw: unknown
    try {
      raw = JSON.parse(content)
    } catch {
      return { conversations: [], warnings: [{ reason: 'JSON 解析失败' }] }
    }
    const result = mapWeflowMessages(raw)
    if (onProgress) onProgress(1)
    return result
  },
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/parsers/__tests__/weflow.test.ts`
Expected: PASS（全部测试绿）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/parsers/weflow.ts packages/core/src/parsers/__tests__/weflow.test.ts
git commit -m "feat(core): add weflowParser with content-signature canParse"
```

---

### Task 3: 注册到 `parseFile` + 端到端测试

把 `weflowParser` 接进分发管线，并验证 `parseFile → aggregate → buildReport` 全链路。

**Files:**
- Modify: `packages/core/src/pipeline/parseFile.ts`
- Test: `packages/core/src/parsers/__tests__/weflow.test.ts`（追加端到端用例）

**Interfaces:**
- Consumes: `weflowParser`（Task 2）、`parseFile`/`aggregate`/`buildReport` from `../index`。
- Produces: 无新导出（仅注册）。

- [ ] **Step 1: 追加失败的端到端测试**

Append to `packages/core/src/parsers/__tests__/weflow.test.ts`:

```ts
import { parseFile, aggregate, buildReport } from '../../index'

describe('weflow end-to-end via parseFile', () => {
  const content = JSON.stringify(sample)

  it('parseFile dispatches WeFlow JSON to weflowParser', () => {
    const { conversations } = parseFile('chat.json', content)
    expect(conversations).toHaveLength(1)
    expect(conversations[0].peerName).toBe('测试好友')
  })

  it('parses → aggregates → builds report', () => {
    const { conversations } = parseFile('chat.json', content)
    const friends = aggregate(conversations)
    const report = buildReport(conversations, friends, 2024)
    expect(friends).toHaveLength(1)
    expect(friends[0].name).toBe('测试好友')
    expect(friends[0].sentRatio).toBe(50)
    expect(report.totalMessages).toBe(4)
    expect(report.activeDays).toBe(2)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/parsers/__tests__/weflow.test.ts`
Expected: FAIL —— `parseFile` 对 `chat.json` 返回"无法识别的文件格式"，`conversations` 为空。

- [ ] **Step 3: 注册 parser**

Modify `packages/core/src/pipeline/parseFile.ts`:

```ts
import type { Parser, ParseResult } from '../model/types'
import { txtParser } from '../parsers/txt'
import { htmlParser } from '../parsers/html'
import { weflowParser } from '../parsers/weflow'

const PARSERS: Parser[] = [weflowParser, htmlParser, txtParser] // weflow/html 先嗅探(更具体)
```

（其余函数体不变。）

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/parsers/__tests__/weflow.test.ts`
Expected: PASS。

- [ ] **Step 5: 跑全量 core 测试，确认无回归**

Run: `pnpm --filter @nianlun/core test`
Expected: 全绿（既有 txt/html/backup/integration 测试不受影响）。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/pipeline/parseFile.ts packages/core/src/parsers/__tests__/weflow.test.ts
git commit -m "feat(core): register weflowParser in parseFile pipeline"
```

---

### Task 4: 用真实 WeFlow 导出校验（人工闸门）

防御式候选 key 让前 3 个 Task 不依赖真实样本即可完成。本 Task 在拿到真实导出后做一次校验/对齐，是发布前的把关。

**Files:**
- Modify（按需）: `packages/core/src/parsers/weflow.ts`（仅 `F` 候选数组 / `TYPE_MAP`）
- Modify（按需）: `packages/core/src/parsers/__tests__/fixtures/weflow-sample.json`

- [ ] **Step 1: 取真实样本**

用 WeFlow 导出**一个会话**为 JSON。检查真实结构：
- 顶层是对象还是数组？消息数组的 key 叫什么？
- 每条消息的时间/发送者/类型/正文字段实际叫什么？时间是秒还是毫秒？
- 群聊如何标识？

- [ ] **Step 2: 对齐 `F` / `TYPE_MAP`**

把真实字段名补进 `weflow.ts` 的 `F` 对应数组（若已覆盖则无需改）。若真实时间是毫秒，`toMs` 的 `< 1e12` 判据已自动兼容。若出现未映射的 `type` 码且需要区分，补进 `TYPE_MAP`。

> 若真实顶层是**消息平铺数组**而非 `{ messages: [...] }` 对象，则 `mapWeflowMessages` 与 `canParse` 需扩展以接受数组顶层——这是已知假设点，届时新增对应测试再改。

- [ ] **Step 3: 用真实结构替换 fixture 并回归**

把脱敏后的真实样本写入 `weflow-sample.json`（正文可替换为假数据，**保留真实字段名与结构**），运行：

Run: `pnpm --filter @nianlun/core test`
Expected: 全绿。若有失败，按真实结构修正映射直至通过。

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/parsers/weflow.ts packages/core/src/parsers/__tests__/fixtures/weflow-sample.json
git commit -m "fix(core): reconcile WeFlow parser fields with real export"
```

---

## 完成标准

- `pnpm --filter @nianlun/core test` 全绿。
- 从 WeFlow 导出的真实会话 JSON 拖入年轮后，好友表与年度报告正确显示（手动验证，可用 `pnpm --filter @nianlun/web dev`）。
- 未改动任何现有解析器；未引入新依赖；core 仍无 DOM 依赖。
