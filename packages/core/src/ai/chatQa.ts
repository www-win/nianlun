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

// 常见功能性 bigram，抽关键词时剔除，减少拿它们去匹配聊天原文造成的噪声。
const STOP_BIGRAMS = new Set([
  '什么', '怎么', '为什', '是不', '不是', '有没', '没有', '我们', '他们',
  '这个', '那个', '一下', '最近', '上次', '现在', '已经', '可以', '知道',
  '告诉', '关于', '时候', '的话', '就是', '也就',
])

/**
 * 从问题抽关键词，用于过滤聊天原文。小程序运行时无分词器（且可能无 Intl.Segmenter，
 * 同 TextEncoder 缺失之坑），故不依赖分词：中文按 2 字滑窗生成 bigram、字母数字取整词，
 * 剔除 exclude(如好友名) 与常见功能性 bigram。
 */
export function extractKeywords(question: string, exclude: string[] = []): string[] {
  let q = question
  for (const e of exclude) if (e) q = q.split(e).join(' ')
  const out: string[] = []
  const push = (k: string) => { if (k && !STOP_BIGRAMS.has(k) && !out.includes(k)) out.push(k) }
  // 中文：连续中文段按 2 字滑窗生成 bigram
  for (const run of q.match(/[一-龥]{2,}/g) ?? []) {
    for (let i = 0; i + 2 <= run.length; i++) push(run.slice(i, i + 2))
  }
  // 字母数字：整词（统一小写）
  for (const w of q.match(/[A-Za-z0-9]{2,}/g) ?? []) push(w.toLowerCase())
  return out
}

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
