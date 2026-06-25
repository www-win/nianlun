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
