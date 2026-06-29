import type { Friend } from '../model/types'

export function sumHourly(friends: Friend[]): number[] {
  const out = new Array(24).fill(0)
  for (const f of friends) for (let i = 0; i < 24; i++) out[i] += f.hourly[i] ?? 0
  return out
}

export function sumWeekHour(friends: Friend[]): number[] {
  const out = new Array(168).fill(0)
  for (const f of friends) for (let i = 0; i < 168; i++) out[i] += f.weekHour[i] ?? 0
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
