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

  const words: string[] = []
  const Seg = (globalThis as any).Intl?.Segmenter
  if (typeof Seg === 'function') {
    try {
      const seg = new Seg('zh', { granularity: 'word' })
      for (const s of seg.segment(q)) {
        if (!s.isWordLike) continue
        const w = s.segment
        if (w.length < 2) continue
        words.push(w)
      }
    } catch { /* 降级到 bigram */ }
  }

  if (words.length === 0) {
    // bigram 降级
    const en = q.match(/[A-Za-z0-9]{2,}/g) ?? []
    for (const w of en) words.push(w)
    const cjkRuns = q.replace(/[^一-龥]+/g, ' ').trim().split(/\s+/).filter(Boolean)
    for (const run of cjkRuns) {
      for (let i = 0; i + 1 < run.length; i++) {
        words.push(run.slice(i, i + 2))
      }
    }
  }

  const out: string[] = []
  for (const w of words) {
    if (STOPWORDS.has(w)) continue
    if (!out.includes(w)) out.push(w)
  }
  return out
}
