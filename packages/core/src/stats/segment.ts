import { STOPWORDS } from './stopwords'

const HAS_CJK = /[一-鿿]/
const EN_WORD = /^[a-zA-Z]{2,}$/
const SEGMENTER = new Intl.Segmenter('zh', { granularity: 'word' })

export function tokenize(text: string): string[] {
  const seg = SEGMENTER
  const out: string[] = []
  for (const s of seg.segment(text)) {
    if (!s.isWordLike) continue
    const w = s.segment
    if (w.length < 2) continue
    if (!HAS_CJK.test(w) && !EN_WORD.test(w)) continue // 丢纯数字/标点/符号
    if (STOPWORDS.has(w)) continue
    out.push(w)
  }
  return out
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
