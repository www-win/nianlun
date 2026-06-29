import type { Friend } from '../model/types'

export function sumHourly(friends: Friend[]): number[] {
  const out = new Array(24).fill(0)
  // f.hourly 可能在老数据里缺失(charts 字段是后加的),用 ?? [] 守卫,与 mergeKeywords 一致
  for (const f of friends) {
    const h = f.hourly ?? []
    for (let i = 0; i < 24; i++) out[i] += h[i] ?? 0
  }
  return out
}

export function sumWeekHour(friends: Friend[]): number[] {
  const out = new Array(168).fill(0)
  for (const f of friends) {
    const w = f.weekHour ?? []
    for (let i = 0; i < 168; i++) out[i] += w[i] ?? 0
  }
  return out
}

export function mergeKeywords(
  friends: Friend[],
  topN: number,
): Array<{ word: string; count: number }> {
  const counts = new Map<string, number>()
  for (const f of friends) {
    for (const k of f.keywords ?? []) counts.set(k.word, (counts.get(k.word) ?? 0) + k.count)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }))
}
