import { describe, it, expect } from 'vitest'
import { buildEgoGraph } from '../egoGraph'
import { createFriend } from '../../model/friend'
import type { Friend } from '../../model/types'

function f(id: string, rel: Friend['rel'], msgCount: number): Friend {
  const x = createFriend(id, id)
  x.rel = rel
  x.msgCount = msgCount
  return x
}

describe('buildEgoGraph', () => {
  it('returns no nodes for empty input', () => {
    expect(buildEgoGraph([]).nodes).toEqual([])
  })

  it('produces one node per friend', () => {
    const g = buildEgoGraph([f('a', '家人', 10), f('b', '同事', 20)])
    expect(g.nodes.length).toBe(2)
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
  })

  it('places the most-messaged friend closest to centre and largest', () => {
    const g = buildEgoGraph([f('hi', '挚友', 1000), f('lo', '挚友', 10)])
    const hi = g.nodes.find((n) => n.id === 'hi')!
    const lo = g.nodes.find((n) => n.id === 'lo')!
    expect(hi.radiusFraction).toBeCloseTo(0.25)   // R_MIN
    expect(hi.sizeFraction).toBeCloseTo(1)
    expect(hi.radiusFraction).toBeLessThan(lo.radiusFraction)
    expect(hi.sizeFraction).toBeGreaterThan(lo.sizeFraction)
  })

  it('gives a larger angular sector to relations with more members', () => {
    const friends = [
      f('f1', '家人', 4), f('f2', '家人', 3), f('f3', '家人', 2), f('f4', '家人', 1),
      f('w1', '同事', 4), f('w2', '同事', 3),
    ]
    const g = buildEgoGraph(friends)
    const extent = (rel: string) => {
      const a = g.nodes.filter((n) => n.rel === rel).map((n) => n.angle)
      return Math.max(...a) - Math.min(...a)
    }
    expect(extent('家人')).toBeGreaterThan(extent('同事'))
  })

  it('is deterministic', () => {
    const make = () => [f('a', '家人', 10), f('b', '同事', 20), f('c', '同学', 5)]
    expect(buildEgoGraph(make())).toEqual(buildEgoGraph(make()))
  })

  it('does not divide by zero when every friend has zero messages', () => {
    const g = buildEgoGraph([f('a', '家人', 0), f('b', '同事', 0)])
    for (const n of g.nodes) {
      expect(Number.isFinite(n.radiusFraction)).toBe(true)
      expect(Number.isFinite(n.sizeFraction)).toBe(true)
    }
  })
})
