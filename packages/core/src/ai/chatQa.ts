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
