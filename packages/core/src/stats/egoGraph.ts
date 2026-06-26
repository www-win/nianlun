import type { Friend, Relation } from '../model/types'

export interface EgoNode {
  id: string
  name: string
  rel: Relation
  angle: number           // 弧度
  radiusFraction: number  // 0–1，0=圆心，1=最外圈
  sizeFraction: number    // 0–1，节点相对大小
  msgCount: number
}

export interface EgoGraph {
  nodes: EgoNode[]
}

const REL_ORDER: Relation[] = ['家人', '挚友', '同事', '同学', '客户', '其他']
const TWO_PI = Math.PI * 2
const R_MIN = 0.25   // 联系最密 → 最靠近圆心
const R_MAX = 1
const SIZE_MIN = 0.35

export function buildEgoGraph(friends: Friend[]): EgoGraph {
  if (friends.length === 0) return { nodes: [] }

  const maxMsg = Math.max(...friends.map((f) => f.msgCount), 1)

  // 1) 按关系分组，仅保留非空组，按固定顺序
  const groups = REL_ORDER
    .map((rel) => ({ rel, members: friends.filter((f) => f.rel === rel) }))
    .filter((g) => g.members.length > 0)

  // 2) 加性平滑分配扇区角度：weight = count + 1，保证单人组也有非零扇区
  const weights = groups.map((g) => g.members.length + 1)
  const weightSum = weights.reduce((a, b) => a + b, 0)

  const nodes: EgoNode[] = []
  let angleCursor = 0
  groups.forEach((g, gi) => {
    const span = (weights[gi] / weightSum) * TWO_PI
    const ordered = [...g.members].sort((a, b) => b.msgCount - a.msgCount)
    const n = ordered.length
    ordered.forEach((fr, i) => {
      const angle = angleCursor + span * ((i + 0.5) / n)
      const norm = fr.msgCount / maxMsg   // 0..1
      nodes.push({
        id: fr.id,
        name: fr.name,
        rel: fr.rel,
        angle,
        radiusFraction: R_MAX - norm * (R_MAX - R_MIN),
        sizeFraction: SIZE_MIN + norm * (1 - SIZE_MIN),
        msgCount: fr.msgCount,
      })
    })
    angleCursor += span
  })

  return { nodes }
}
