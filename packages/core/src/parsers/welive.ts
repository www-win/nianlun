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
