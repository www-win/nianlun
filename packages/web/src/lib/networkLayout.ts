// 以「我」为中心的星形关系亲疏图布局。纯函数、确定性(无随机/无时间)。
// 角度=关系类型扇区,半径=亲密度(msgCount)排名分位:越亲密越靠圆心。
import type { Friend, Relation } from '@nianlun/core'
import { RELATIONS, relColor } from './relations'

export interface NodeLayout {
  id: string
  name: string
  rel: Relation
  x: number
  y: number
  r: number
  color: string
  msgCount: number
}

export interface LayoutInput {
  friends: Friend[]
  size: number
  activeRels: Set<Relation>
}

// 确定性字符串哈希(FNV-1a),归一化到 [0,1),用于同扇区内角度错位避免重叠。
function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 0x100000000
}

export function computeLayout(input: LayoutInput): NodeLayout[] {
  const { friends, size, activeRels } = input
  const visible = friends.filter((f) => activeRels.has(f.rel))
  if (visible.length === 0) return []

  const center = size / 2
  const innerR = size * 0.13 // 中心留给「我」核心
  const outerR = size * 0.46 // 外圈留边距
  const sector = (2 * Math.PI) / RELATIONS.length

  // 亲密度排名:按 msgCount 升序,同值按 id 稳定排序(保证确定性)。
  const ranked = [...visible].sort(
    (a, b) => a.msgCount - b.msgCount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  const n = ranked.length
  const rankOf = new Map(ranked.map((f, i) => [f.id, i]))

  return visible.map((f) => {
    const i = rankOf.get(f.id)! // 0=最疏, n-1=最亲
    const t = n > 1 ? i / (n - 1) : 0.5
    const radius = outerR - t * (outerR - innerR) // 越亲密(t大)越靠内
    const si = Math.max(0, RELATIONS.indexOf(f.rel))
    const angle = si * sector + hash01(f.id) * sector // 扇区基角 + 扇区内错位
    return {
      id: f.id,
      name: f.name,
      rel: f.rel,
      x: center + radius * Math.cos(angle),
      y: center + radius * Math.sin(angle),
      r: 4 + t * 8, // 亲密的节点更大(4~12px)
      color: relColor(f.rel),
      msgCount: f.msgCount,
    }
  })
}
