import { describe, it, expect } from 'vitest'
import { egoLayout } from '../egoLayout'
import type { Friend, Relation } from '@nianlun/core'

const mk = (id: string, rel: Relation, msgCount: number): Friend =>
  ({ id, name: id, alias: '', rel, msgCount } as unknown as Friend)

const SIZE = 600

describe('egoLayout', () => {
  it('空好友返回空', () => {
    expect(egoLayout([], SIZE)).toEqual([])
  })

  it('截断到 topN（按 msgCount 取往来最多）', () => {
    const friends = Array.from({ length: 40 }, (_, i) => mk(`f${i}`, '其他', i))
    const out = egoLayout(friends, SIZE, { topN: 30 })
    expect(out).toHaveLength(30)
    // 最少的 f0..f9 不应出现（被截掉）
    expect(out.find((n) => n.id === 'f0')).toBeUndefined()
    expect(out.find((n) => n.id === 'f39')).toBeDefined()
  })

  it('按 activeRels 过滤', () => {
    const friends = [mk('a', '家人', 10), mk('b', '同事', 20), mk('c', '其他', 30)]
    const out = egoLayout(friends, SIZE, { activeRels: new Set<Relation>(['同事']) })
    expect(out.map((n) => n.id)).toEqual(['b'])
  })

  it('往来最多的更靠近圆心、颜色随关系', () => {
    const friends = [mk('lo', '挚友', 1), mk('hi', '挚友', 100)]
    const out = egoLayout(friends, SIZE)
    const center = SIZE / 2
    const dist = (n: { x: number; y: number }) => Math.hypot(n.x - center, n.y - center)
    const hi = out.find((n) => n.id === 'hi')!
    const lo = out.find((n) => n.id === 'lo')!
    expect(dist(hi)).toBeLessThan(dist(lo)) // 聊得多的离中心更近
    expect(hi.r).toBeGreaterThan(lo.r) // 聊得多的点更大
    expect(hi.color).toBe('#43a86a') // 挚友色
    // 坐标落在画面内
    expect(hi.x).toBeGreaterThanOrEqual(0)
    expect(hi.x).toBeLessThanOrEqual(SIZE)
  })

  it('用 alias 优先显示名字', () => {
    const f = { id: 'x', name: '本名', alias: '备注名', rel: '其他', msgCount: 5 } as unknown as Friend
    expect(egoLayout([f], SIZE)[0].name).toBe('备注名')
  })
})
