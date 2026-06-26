import type { Conversation, Friend, Relation } from '../model/types'

const RELATIONS: Relation[] = ['家人', '挚友', '同事', '同学', '客户', '其他']

export interface ExtractSamplesOptions {
  /** 每个好友最多保留的样本条数（默认 30） */
  maxPerFriend?: number
  /** 单条文本截断到的最大字符数（默认 80） */
  maxChars?: number
}

/**
 * 从会话里截取每个好友的有界消息样本，供 AI 推断关系/职务。
 * 纯函数：键为会话 id（= Friend.id），值为带收发方向标注的文本片段数组。
 * 仅取非空的 text 消息；超出条数上限时按时间均匀采样以兼顾早晚。
 */
export function extractFriendSamples(
  conversations: Conversation[],
  opts: ExtractSamplesOptions = {},
): Record<string, string[]> {
  const maxPerFriend = opts.maxPerFriend ?? 30
  const maxChars = opts.maxChars ?? 80

  const out: Record<string, string[]> = {}
  for (const conv of conversations) {
    const texts = conv.messages
      .filter((m) => m.type === 'text' && typeof m.text === 'string' && m.text.trim() !== '')
      .slice()
      .sort((a, b) => a.ts - b.ts)

    const picked = sampleEvenly(texts, maxPerFriend)
    out[conv.id] = picked.map((m) => {
      const who = m.from === 'me' ? '我' : '对方'
      const body = (m.text ?? '').trim().slice(0, maxChars)
      return `${who}：${body}`
    })
  }
  return out
}

function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items
  const result: T[] = []
  // 均匀取 max 个下标，保持时间顺序
  for (let i = 0; i < max; i++) {
    const idx = Math.floor((i * items.length) / max)
    result.push(items[idx])
  }
  return result
}

/**
 * 单个好友 + 消息样本 → 提示词，要求 AI 只输出严格 JSON。
 */
export function buildFriendSuggestionPrompt(friend: Friend, samples: string[]): string {
  const displayName = friend.alias || friend.name
  const sampleBlock = samples.length
    ? samples.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '（本次无可用聊天样本）'

  return [
    '你是一位擅长从聊天记录中判断人际关系的助手。',
    '请根据下面这位微信好友的聚合统计与部分聊天内容样本，推断你们的「关系」与对方的「职务/身份」。',
    '',
    `只输出一个严格的 JSON 对象，不要任何解释、不要代码围栏外的文字。格式：`,
    `{"rel": "<下列之一：${RELATIONS.join(' | ')}>", "role": "<职务或身份标签，简短，无法判断则空字符串>", "reason": "<一句话依据>"}`,
    '',
    '聚合统计：',
    `- 好友：${displayName}`,
    `- 当前关系标签：${friend.rel}`,
    `- 当前职务/备注：${friend.role || '（未填）'}`,
    `- 全年消息往来：${friend.msgCount} 条`,
    `- 我方发送占比：${friend.sentRatio}%`,
    `- 活跃时段：${friend.peakPeriod || '（无）'}`,
    `- 最长连续聊天：${friend.maxStreak} 天`,
    '',
    '部分聊天内容样本（仅为片段，「我」为用户本人，「对方」为该好友）：',
    sampleBlock,
  ].join('\n')
}

export interface FriendSuggestion {
  rel?: Relation
  role?: string
  reason?: string
}

function isRelation(v: unknown): v is Relation {
  return typeof v === 'string' && (RELATIONS as string[]).includes(v)
}

/**
 * 解析 AI 返回文本为结构化建议。容错：剥除围栏与多余文字、定位首个 JSON、
 * 校验 rel 合法性、trim role/reason。完全无法解析时返回 {}，永不抛异常。
 */
export function parseFriendSuggestion(text: string): FriendSuggestion {
  if (typeof text !== 'string') return {}
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return {}

  let obj: unknown
  try {
    obj = JSON.parse(text.slice(start, end + 1))
  } catch {
    return {}
  }
  if (typeof obj !== 'object' || obj === null) return {}

  const record = obj as Record<string, unknown>
  const result: FriendSuggestion = {}
  if (isRelation(record.rel)) result.rel = record.rel
  if (typeof record.role === 'string' && record.role.trim() !== '') result.role = record.role.trim()
  if (typeof record.reason === 'string' && record.reason.trim() !== '') {
    result.reason = record.reason.trim()
  }
  return result
}
