import { STOPWORDS } from './stopwords'

const HAS_CJK = /[一-鿿]/
const EN_WORD = /^[a-zA-Z]{2,}$/

type TokFn = (text: string) => string[]
let cached: TokFn | null = null

function makeTokenizer(): TokFn {
  // 优先用 Intl.Segmenter（更准）；引擎不支持则降级 bigram。
  const Seg = (globalThis as any).Intl?.Segmenter
  if (typeof Seg === 'function') {
    try {
      const seg = new Seg('zh', { granularity: 'word' })
      return (text: string) => {
        const out: string[] = []
        for (const s of seg.segment(text)) {
          if (!s.isWordLike) continue
          const w = s.segment
          if (w.length < 2) continue
          if (!HAS_CJK.test(w) && !EN_WORD.test(w)) continue
          if (STOPWORDS.has(w)) continue
          out.push(w)
        }
        return out
      }
    } catch { /* 落到 bigram */ }
  }
  return bigramTokenize
}

// 中文二元降级：相邻两个 CJK 字成词；英文整词单独保留。
function bigramTokenize(text: string): string[] {
  const out: string[] = []
  // 英文整词
  const en = text.match(/[a-zA-Z]{2,}/g) ?? []
  for (const w of en) if (!STOPWORDS.has(w)) out.push(w)
  // CJK 二元
  const cjk = text.replace(/[^一-鿿]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  for (const run of cjk) {
    for (let i = 0; i + 1 < run.length; i++) {
      const w = run.slice(i, i + 2)
      if (STOPWORDS.has(w)) continue
      out.push(w)
    }
  }
  return out
}

export function tokenize(text: string): string[] {
  if (!cached) cached = makeTokenizer()
  return cached(text)
}

export function countWords(
  texts: Iterable<string>,
  topN: number,
): Array<{ word: string; count: number }> {
  const counts = new Map<string, number>()
  for (const text of texts) {
    for (const w of tokenize(text)) counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }))
}
