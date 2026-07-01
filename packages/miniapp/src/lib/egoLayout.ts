// 以「我」为中心的星形关系亲疏图布局（移植自网页版 computeLayout）。
// 纯函数、确定性：角度=关系扇区+确定性错位，半径=亲密度(msgCount)排名（越亲密越靠圆心）。
import type { Friend, Relation } from '@nianlun/core'

const RELATIONS: Relation[] = ['家人', '挚友', '同事', '同学', '客户', '其他']
const REL_COLORS: Record<string, string> = {
  家人: '#d96a5a', 挚友: '#43a86a', 同事: '#5a7fd0', 同学: '#cf9a36', 客户: '#b066b0', 其他: '#8a8f99',
}
const relColor = (r: string) => REL_COLORS[r] || '#8a8f99'

export interface EgoNode {
  id: string; name: string; rel: Relation
  x: number; y: number; r: number; color: string; msgCount: number
}

export interface EgoLayoutOptions { activeRels?: Set<Relation>; topN?: number }

// 确定性哈希(FNV-1a)→[0,1)，用于同扇区内角度错位避免重叠。
function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0) / 0x100000000
}

export function egoLayout(friends: Friend[], size: number, opts: EgoLayoutOptions = {}): EgoNode[] {
  const topN = opts.topN ?? 30
  let pool = [...friends].sort((a, b) => b.msgCount - a.msgCount).slice(0, topN)
  if (opts.activeRels) pool = pool.filter((f) => opts.activeRels!.has(f.rel))
  if (pool.length === 0) return []

  const center = size / 2
  const innerR = size * 0.14 // 中心留给「我」
  const outerR = size * 0.46 // 外圈留边距
  const sector = (2 * Math.PI) / RELATIONS.length

  // 亲密度排名：msgCount 升序，同值按 id 稳定排序（确定性）。
  const ranked = [...pool].sort(
    (a, b) => a.msgCount - b.msgCount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  const n = ranked.length
  const rankOf = new Map(ranked.map((f, i) => [f.id, i]))

  return pool.map((f) => {
    const i = rankOf.get(f.id)! // 0=最疏, n-1=最亲
    const t = n > 1 ? i / (n - 1) : 0.5
    const radius = outerR - t * (outerR - innerR) // 越亲密(t大)越靠内
    const si = Math.max(0, RELATIONS.indexOf(f.rel))
    const angle = si * sector + hash01(f.id) * sector
    return {
      id: f.id,
      name: f.alias || f.name,
      rel: f.rel,
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
      r: size * 0.02 + t * size * 0.028, // 亲密的点更大
      color: relColor(f.rel),
      msgCount: f.msgCount,
    }
  })
}
