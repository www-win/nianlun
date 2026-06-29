import { describe, it, expect } from 'vitest'
import { computeLayout } from '../networkLayout'
import { RELATIONS } from '../relations'
import type { Friend, Relation } from '@nianlun/core'

function makeFriend(id: string, rel: Relation, msgCount: number): Friend {
  return {
    id, name: id, alias: '', rel, role: '',
    firstContact: 0, lastContact: 0, msgCount, sentRatio: 50,
    peakPeriod: '', maxStreak: 0, monthly: Array(12).fill(0), userEdited: {},
  }
}
const SIZE = 720
const CENTER = SIZE / 2
const ALL = () => new Set<Relation>(RELATIONS)
const dist = (n: { x: number; y: number }) => Math.hypot(n.x - CENTER, n.y - CENTER)

describe('computeLayout', () => {
  it('空好友返回空数组', () => {
    expect(computeLayout({ friends: [], size: SIZE, activeRels: ALL() })).toEqual([])
  })

  it('只返回 activeRels 内的关系节点', () => {
    const friends = [
      makeFriend('a', '家人', 10),
      makeFriend('b', '同事', 10),
      makeFriend('c', '同学', 10),
    ]
    const out = computeLayout({ friends, size: SIZE, activeRels: new Set<Relation>(['家人']) })
    expect(out.map((n) => n.id)).toEqual(['a'])
  })

  it('全部隐藏(空 activeRels)返回空', () => {
    const friends = [makeFriend('a', '家人', 10)]
    expect(computeLayout({ friends, size: SIZE, activeRels: new Set() })).toEqual([])
  })

  it('消息越多离圆心越近(亲密度=半径单调)', () => {
    const friends = [
      makeFriend('low', '家人', 10),
      makeFriend('mid', '家人', 100),
      makeFriend('high', '家人', 1000),
    ]
    const out = computeLayout({ friends, size: SIZE, activeRels: ALL() })
    const by = Object.fromEntries(out.map((n) => [n.id, n]))
    expect(dist(by.high)).toBeLessThan(dist(by.mid))
    expect(dist(by.mid)).toBeLessThan(dist(by.low))
  })

  it('消息越多节点越大', () => {
    const friends = [makeFriend('low', '家人', 10), makeFriend('high', '家人', 1000)]
    const out = computeLayout({ friends, size: SIZE, activeRels: ALL() })
    const by = Object.fromEntries(out.map((n) => [n.id, n]))
    expect(by.high.r).toBeGreaterThan(by.low.r)
  })

  it('节点角度落在所属关系的扇区内', () => {
    // 家人是 RELATIONS[0] → 扇区 [0, 60°)，即落在第一象限 (x>=center, y>=center)
    const out = computeLayout({ friends: [makeFriend('a', '家人', 10)], size: SIZE, activeRels: ALL() })
    const n = out[0]
    const sector = (2 * Math.PI) / RELATIONS.length
    let ang = Math.atan2(n.y - CENTER, n.x - CENTER)
    if (ang < 0) ang += 2 * Math.PI
    expect(ang).toBeGreaterThanOrEqual(0)
    expect(ang).toBeLessThan(sector)
  })

  it('相同输入产出完全相同(确定性)', () => {
    const friends = [makeFriend('a', '家人', 10), makeFriend('b', '同事', 50)]
    const a = computeLayout({ friends, size: SIZE, activeRels: ALL() })
    const b = computeLayout({ friends, size: SIZE, activeRels: ALL() })
    expect(a).toEqual(b)
  })
})
