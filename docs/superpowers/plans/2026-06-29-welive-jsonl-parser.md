# WeLive JSONL 导入解析器 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让年轮能导入 WeLive 导出的微信聊天记录 `.jsonl` 文件。

**Architecture:** 新增独立的 `weliveParser`（纯函数，core 包），从文件名取会话 id；给 `Parser.parse` 加可选 `fileName` 参数并在 pipeline 中透传；ImportPage 的文件选择器加 `.jsonl`。不改动现有 `weflowParser`。

**Tech Stack:** TypeScript（`@nianlun/core` 纯库，无 DOM）、Vitest、Vue 3（`@nianlun/web`）。

## Global Constraints

- `@nianlun/core` 是纯 TS 库：不得 import `web`，不得触碰 `window`/`document`/`IndexedDB`/`vue`（`tsconfig` 用 `"lib":["ES2020"]`、`"types":[]` 强制约束）。
- 解析器必须容错：坏行收进 `warnings`，**永不抛异常**。
- 包管理用 **pnpm**（不要 npm/yarn）。
- 设计文档：[2026-06-29-welive-jsonl-parser-design.md](../specs/2026-06-29-welive-jsonl-parser-design.md)。
- 现有约定：`Conversation.id === peerName`（见 `merge/merge.ts` 注释）。
- 真实样本目录（仅供参考，勿入库）：`C:\Users\MagicBooK\Desktop\welive_export\exports`。
- 测试命令：`pnpm --filter @nianlun/core test`、`pnpm --filter @nianlun/web test`。

---

### Task 1: 新增 `weliveParser`（core，纯函数）

**Files:**
- Create: `packages/core/src/parsers/welive.ts`
- Test: `packages/core/src/parsers/__tests__/welive.test.ts`

**Interfaces:**
- Consumes: `Conversation`, `Message`, `ParseWarning`, `Parser`, `ParseResult`（来自 `../model/types`）。
- Produces:
  - `export function sessionIdFromFileName(fileName: string): string`
  - `export function isServiceSession(sessionId: string): boolean`
  - `export const weliveParser: Parser`，其中 `parse(content: string, onProgress?: (p: number) => void, fileName?: string): ParseResult`

- [ ] **Step 1: 写失败测试**

创建 `packages/core/src/parsers/__tests__/welive.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { weliveParser, sessionIdFromFileName, isServiceSession } from '../welive'

// 真实 WeLive 行的脱敏样本（字段顺序与真实导出一致）
const line = (o: Record<string, unknown>) => JSON.stringify({
  sort_seq: '1', create_time: '1782207175', local_id: '1', server_id: 'x',
  local_type: '1', real_sender_id: '1', message_content: '', sender_username: '',
  ...o,
})

describe('sessionIdFromFileName', () => {
  it('strips trailing _<8hex> and extension', () => {
    expect(sessionIdFromFileName('wxid_9n9z014h9axh22_caef54c8.jsonl')).toBe('wxid_9n9z014h9axh22')
    expect(sessionIdFromFileName('25032865050@chatroom_bb6fc02f.jsonl')).toBe('25032865050@chatroom')
  })
  it('falls back to base name when no hash suffix', () => {
    expect(sessionIdFromFileName('weird.jsonl')).toBe('weird')
  })
})

describe('isServiceSession', () => {
  it('flags official accounts and service ids', () => {
    expect(isServiceSession('gh_057d181d2822')).toBe(true)
    expect(isServiceSession('filehelper')).toBe(true)
    expect(isServiceSession('weixin')).toBe(true)
    expect(isServiceSession('notifymessage')).toBe(true)
  })
  it('keeps real contacts and groups', () => {
    expect(isServiceSession('wxid_abc')).toBe(false)
    expect(isServiceSession('123@chatroom')).toBe(false)
    expect(isServiceSession('123@openim')).toBe(false)
  })
})

describe('weliveParser.canParse', () => {
  it('accepts a WeLive jsonl first line', () => {
    expect(weliveParser.canParse('chat.jsonl', line({}))).toBe(true)
  })
  it('skips blank leading lines and a BOM', () => {
    expect(weliveParser.canParse('chat.jsonl', '﻿\n' + line({}))).toBe(true)
  })
  it('rejects a weflow message object', () => {
    const weflow = JSON.stringify({ talker: 'x', messages: [{ createTime: 1, isSender: 0 }] })
    expect(weliveParser.canParse('chat.json', weflow)).toBe(false)
  })
  it('rejects a nianlun friend-backup array', () => {
    expect(weliveParser.canParse('好友.json', '[{"name":"张三"}]')).toBe(false)
  })
})

describe('weliveParser.parse — private chat', () => {
  const content = [
    line({ create_time: '1782207175', local_type: '1', message_content: '你好', sender_username: 'wxid_peer' }),
    line({ create_time: '1782207200', local_type: '1', message_content: '在的', sender_username: '' }),
  ].join('\n')

  it('uses filename session id for id and peerName', () => {
    const { conversations } = weliveParser.parse(content, undefined, 'wxid_peer_aabbccdd.jsonl')
    expect(conversations).toHaveLength(1)
    expect(conversations[0].id).toBe('wxid_peer')
    expect(conversations[0].peerName).toBe('wxid_peer')
    expect(conversations[0].isGroup).toBe(false)
  })
  it('maps empty sender to me, non-empty to them', () => {
    const m = weliveParser.parse(content, undefined, 'wxid_peer_aabbccdd.jsonl').conversations[0].messages
    expect(m[0].from).toBe('them')
    expect(m[1].from).toBe('me')
  })
  it('converts Unix seconds to milliseconds and keeps text', () => {
    const m = weliveParser.parse(content, undefined, 'wxid_peer_aabbccdd.jsonl').conversations[0].messages
    expect(m[0].ts).toBe(1782207175 * 1000)
    expect(m[0].text).toBe('你好')
  })
})

describe('weliveParser.parse — group chat', () => {
  const content = [
    line({ local_type: '1', message_content: 'wxid_a:\n收89', sender_username: 'wxid_a' }),
    line({ local_type: '1', message_content: '我发的', sender_username: '' }),
  ].join('\n')

  it('strips the <sender>:\\n prefix from group text', () => {
    const c = weliveParser.parse(content, undefined, '123@chatroom_aabbccdd.jsonl').conversations[0]
    expect(c.isGroup).toBe(true)
    expect(c.messages[0].text).toBe('收89')
    expect(c.messages[0].from).toBe('them')
    expect(c.messages[1].text).toBe('我发的')
    expect(c.messages[1].from).toBe('me')
  })
})

describe('weliveParser.parse — types & robustness', () => {
  it('maps base type from a composite local_type (49 | 62<<32)', () => {
    const content = line({ local_type: '266287972401', message_content: '不可读hex', sender_username: 'wxid_x' })
    const m = weliveParser.parse(content, undefined, 'wxid_x_aabbccdd.jsonl').conversations[0].messages
    expect(m[0].type).toBe('other')
    expect(m[0].text).toBe('') // 非文本不取 message_content
  })
  it('maps image/voice/system codes', () => {
    const content = [
      line({ local_type: '3', sender_username: 'wxid_x' }),
      line({ local_type: '34', sender_username: 'wxid_x' }),
      line({ local_type: '10000', sender_username: '' }),
    ].join('\n')
    const m = weliveParser.parse(content, undefined, 'wxid_x_aabbccdd.jsonl').conversations[0].messages
    expect(m[0].type).toBe('image')
    expect(m[1].type).toBe('voice')
    expect(m[2].type).toBe('system')
  })
  it('treats system messages (>=10000) as them even with empty sender', () => {
    const content = line({ local_type: '10000', message_content: '', sender_username: '' })
    const m = weliveParser.parse(content, undefined, 'wxid_x_aabbccdd.jsonl').conversations[0].messages
    expect(m[0].from).toBe('them')
  })
  it('skips bad/blank lines, collects warnings, never throws', () => {
    const content = ['{ not json', '', line({ message_content: 'ok', sender_username: 'wxid_x' })].join('\n')
    const res = weliveParser.parse(content, undefined, 'wxid_x_aabbccdd.jsonl')
    expect(res.conversations[0].messages).toHaveLength(1)
    expect(res.warnings.length).toBe(1)
  })
  it('skips a line with no valid timestamp', () => {
    const content = [
      JSON.stringify({ sort_seq: '1', local_type: '1', message_content: 'x', sender_username: 'wxid_x' }),
      line({ message_content: 'ok', sender_username: 'wxid_x' }),
    ].join('\n')
    const res = weliveParser.parse(content, undefined, 'wxid_x_aabbccdd.jsonl')
    expect(res.conversations[0].messages).toHaveLength(1)
    expect(res.warnings.length).toBe(1)
  })
})

describe('weliveParser.parse — service filtering', () => {
  it('returns empty and no warning for official-account sessions', () => {
    const content = line({ message_content: '广告', sender_username: 'gh_x' })
    const res = weliveParser.parse(content, undefined, 'gh_057d181d2822_ed9d1b80.jsonl')
    expect(res.conversations).toHaveLength(0)
    expect(res.warnings).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/parsers/__tests__/welive.test.ts`
Expected: FAIL —— 找不到模块 `../welive`。

- [ ] **Step 3: 实现 `welive.ts`**

创建 `packages/core/src/parsers/welive.ts`：

```ts
import type { Conversation, Message, ParseWarning, Parser, ParseResult } from '../model/types'

// 非好友会话：公众号(gh_ 前缀)与已知服务号/系统会话，解析时静默跳过
const SERVICE_IDS = new Set([
  'filehelper', 'weixin', 'notifymessage',
  'brandsessionholder', 'brandservicesessionholder',
  'fmessage', 'floatbottle', 'qmessage', 'medianote', 'newsapp',
])

// 微信消息类型码(取 local_type 低 32 位) → 年轮类型
const TYPE_MAP: Record<number, Message['type']> = {
  1: 'text', 3: 'image', 34: 'voice', 43: 'video',
  10000: 'system', 10002: 'system',
}

// 文件名形如 <sessionid>_<8位hex>.jsonl;去掉哈希尾巴与扩展名得到会话 id
export function sessionIdFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '')
  const m = base.match(/^(.*)_[0-9a-f]{8}$/i)
  return m ? m[1] : base
}

export function isServiceSession(sessionId: string): boolean {
  return sessionId.startsWith('gh_') || SERVICE_IDS.has(sessionId)
}

function toMs(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n < 1e12 ? n * 1000 : n // < 1e12 视为秒
}

function baseType(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  return n % 0x100000000 // 取低 32 位(WeLive 的 local_type 可能是复合 64 位值)
}

export const weliveParser: Parser = {
  name: 'welive',

  canParse(_fileName, sample) {
    const firstLine = sample.replace(/^﻿/, '').split(/\r?\n/).find((l) => l.trim())
    if (!firstLine) return false
    const s = firstLine.trim()
    if (!s.startsWith('{')) return false // 好友备份以 '[' 开头
    // 这三个键都在行首附近(message_content 可能极长);借此与 weflow 的 createTime/isSender 区分
    return s.includes('"sort_seq"') && s.includes('"create_time"') && s.includes('"local_type"')
  },

  parse(content, onProgress, fileName = ''): ParseResult {
    const warnings: ParseWarning[] = []
    const sessionId = sessionIdFromFileName(fileName) || 'unknown'

    if (isServiceSession(sessionId)) {
      if (onProgress) onProgress(1)
      return { conversations: [], warnings: [] } // 静默跳过非好友会话
    }

    const isGroup = sessionId.endsWith('@chatroom')
    const messages: Message[] = []
    const lines = content.replace(/^﻿/, '').split(/\r?\n/)

    lines.forEach((line, i) => {
      const t = line.trim()
      if (!t) return
      let r: Record<string, unknown>
      try {
        r = JSON.parse(t)
      } catch {
        warnings.push({ line: i + 1, reason: 'JSON 行解析失败,已跳过' })
        return
      }
      const ts = toMs(r.create_time)
      if (!ts) {
        warnings.push({ line: i + 1, reason: '消息缺少有效时间,已跳过' })
        return
      }
      const bt = baseType(r.local_type)
      const type = TYPE_MAP[bt] ?? 'other'
      const sender = String(r.sender_username ?? '')
      // 系统消息(>=10000)归 them;否则空 sender 视为自己
      const from: Message['from'] = bt >= 10000 ? 'them' : sender === '' ? 'me' : 'them'

      let text = ''
      if (type === 'text') {
        text = String(r.message_content ?? '')
        if (isGroup && sender) {
          const prefix = `${sender}:\n`
          if (text.startsWith(prefix)) text = text.slice(prefix.length)
        }
      }
      messages.push({ ts, from, type, text })
    })

    if (onProgress) onProgress(1)
    const conv: Conversation = { id: sessionId, peerName: sessionId, isGroup, messages }
    return { conversations: messages.length ? [conv] : [], warnings }
  },
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/parsers/__tests__/welive.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/parsers/welive.ts packages/core/src/parsers/__tests__/welive.test.ts
git commit -m "feat(core): add WeLive jsonl parser

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 把 `weliveParser` 接入解析管线

**Files:**
- Modify: `packages/core/src/model/types.ts`（`Parser.parse` 加可选 `fileName`）
- Modify: `packages/core/src/pipeline/parseFile.ts`（透传 `fileName` + 注册 `weliveParser`）
- Test: `packages/core/src/parsers/__tests__/welive.test.ts`（追加 end-to-end 用例）

**Interfaces:**
- Consumes: Task 1 的 `weliveParser`；`parseFile(fileName, content, onProgress?)`、`aggregate`、`buildReport`（来自 `../../index`）。
- Produces: `parseFile` 会把 `fileName` 透传给各 `Parser.parse`。

- [ ] **Step 1: 追加失败的 end-to-end 测试**

在 `packages/core/src/parsers/__tests__/welive.test.ts` 末尾追加：

```ts
import { parseFile, aggregate, buildReport } from '../../index'

describe('welive end-to-end via parseFile', () => {
  const content = [
    line({ create_time: '1782207175', local_type: '1', message_content: '你好', sender_username: 'wxid_peer' }),
    line({ create_time: '1782207200', local_type: '1', message_content: '在的', sender_username: '' }),
  ].join('\n')

  it('dispatches jsonl to weliveParser using the filename', () => {
    const { conversations } = parseFile('wxid_peer_aabbccdd.jsonl', content)
    expect(conversations).toHaveLength(1)
    expect(conversations[0].peerName).toBe('wxid_peer')
  })

  it('parses → aggregates → builds report', () => {
    const { conversations } = parseFile('wxid_peer_aabbccdd.jsonl', content)
    const friends = aggregate(conversations)
    const report = buildReport(conversations, friends, 2026)
    expect(friends).toHaveLength(1)
    expect(friends[0].name).toBe('wxid_peer')
    expect(friends[0].sentRatio).toBe(50)
    expect(report.totalMessages).toBe(2)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/parsers/__tests__/welive.test.ts`
Expected: FAIL —— `parseFile` 不认识 jsonl（无匹配解析器），`conversations` 为空。

- [ ] **Step 3: 给 `Parser.parse` 加可选 `fileName`**

修改 `packages/core/src/model/types.ts` 的 `Parser` 接口（仅这一处）：

```ts
export interface Parser {
  name: string
  canParse(fileName: string, sample: string): boolean
  parse(content: string, onProgress?: (p: number) => void, fileName?: string): ParseResult
}
```

- [ ] **Step 4: 透传 `fileName` 并注册 `weliveParser`**

把 `packages/core/src/pipeline/parseFile.ts` 整体替换为：

```ts
import type { Parser, ParseResult } from '../model/types'
import { txtParser } from '../parsers/txt'
import { htmlParser } from '../parsers/html'
import { weflowParser } from '../parsers/weflow'
import { weliveParser } from '../parsers/welive'

const PARSERS: Parser[] = [weflowParser, weliveParser, htmlParser, txtParser] // 靠内容签名嗅探

export function parseFile(
  fileName: string,
  content: string,
  onProgress?: (p: number) => void,
): ParseResult {
  const sample = content.slice(0, 2000)
  const parser = PARSERS.find((p) => p.canParse(fileName, sample))
  if (!parser) {
    return { conversations: [], warnings: [{ reason: `无法识别的文件格式:${fileName}` }] }
  }
  return parser.parse(content, onProgress, fileName)
}
```

- [ ] **Step 5: 运行 core 全量测试确认通过**

Run: `pnpm --filter @nianlun/core test`
Expected: PASS（含新增 end-to-end 用例与原有所有用例 —— 验证未破坏 weflow/html/txt）。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/model/types.ts packages/core/src/pipeline/parseFile.ts packages/core/src/parsers/__tests__/welive.test.ts
git commit -m "feat(core): wire weliveParser into parseFile and thread fileName

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 导入页接受 `.jsonl`

**Files:**
- Modify: `packages/web/src/pages/ImportPage.vue`（`accept` 列表 + 格式标签）

**Interfaces:**
- Consumes: Task 2 完成后的 `parseFile`（web 经 worker 调用，已传 `f.name`，无需改动 worker/parseClient）。
- Produces: 无（仅 UI 放开文件类型）。

- [ ] **Step 1: 在 `accept` 中加入 `.jsonl`**

修改 `packages/web/src/pages/ImportPage.vue` 文件输入的 `accept`（约第 82 行）：

```html
            accept=".txt,.html,.csv,.json,.jsonl,.png,.jpg,.jpeg,.webp"
```

- [ ] **Step 2: 在格式标签里加一个 `.jsonl`**

修改同文件的格式标签行（约第 70 行），在 `.csv` 之后加 `.jsonl`：

```html
              <span class="tag">.txt</span><span class="tag">.html</span><span class="tag">.csv</span><span class="tag">.jsonl</span><span class="tag">.png</span><span class="tag">.jpg</span><span class="tag">.webp</span>
```

- [ ] **Step 3: 类型检查 + web 测试确认未破坏**

Run: `pnpm --filter @nianlun/web test`
Expected: PASS（现有 `ImportPage.test.ts` 等用例不受影响）。

- [ ] **Step 4: 构建确认无类型错误（vue-tsc）**

Run: `pnpm --filter @nianlun/core build && pnpm --filter @nianlun/web build`
Expected: 两包均构建成功（core 先构建供 web 依赖；web 的 `vue-tsc --noEmit` 通过）。

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/pages/ImportPage.vue
git commit -m "feat(web): accept .jsonl files in import page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 手动验证（实现完成后）

1. `pnpm --filter @nianlun/web dev` 启动开发服务器。
2. 导入页选择 `C:\Users\MagicBooK\Desktop\welive_export\exports` 下的 `.jsonl` 文件
   （可在文件选择器里 Ctrl+A 全选，或挑几个非空的；`.json` 是 UTF-16 空壳，不要选）。
3. 预期：解析完成，好友/群列表出现（名字为 wxid/群号），公众号(gh_)与服务号不出现；
   消息总数与 `session_counts.csv` 大致吻合。
4. 到好友页对在意的联系人行内改名（写入 `userEdited.alias`），再次导入验证改名被保留。
