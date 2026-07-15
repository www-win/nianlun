import { describe, it, expect } from 'vitest'
import { filterSortFriends } from '../friendsList'
import type { Friend } from '@nianlun/core'

const mk = (p: Partial<Friend>): Friend =>
  ({ id: p.name, name: '', alias: '', msgCount: 0, lastContact: 0, ...p } as unknown as Friend)

const A = mk({ name: '张三', alias: '老张', msgCount: 100, lastContact: 5 })
const B = mk({ name: '李四', alias: '', msgCount: 300, lastContact: 1 })
const C = mk({ name: '王五', alias: '阿王', msgCount: 200, lastContact: 9 })

describe('filterSortFriends', () => {
  it('关键字为空：返回全部，按 msgCount 降序', () => {
    const r = filterSortFriends([A, B, C], '', 'msgCount')
    expect(r.map((f) => f.name)).toEqual(['李四', '王五', '张三'])
  })

  it('按 lastContact 降序', () => {
    const r = filterSortFriends([A, B, C], '', 'lastContact')
    expect(r.map((f) => f.name)).toEqual(['王五', '张三', '李四'])
  })

  it('按 name 过滤', () => {
    const r = filterSortFriends([A, B, C], '张', 'msgCount')
    expect(r.map((f) => f.name)).toEqual(['张三'])
  })

  it('按 alias 过滤（name 不含关键字也能命中）', () => {
    const r = filterSortFriends([A, B, C], '阿王', 'msgCount')
    expect(r.map((f) => f.name)).toEqual(['王五'])
  })

  it('关键字首尾空格被 trim', () => {
    const r = filterSortFriends([A, B, C], '  张  ', 'msgCount')
    expect(r.map((f) => f.name)).toEqual(['张三'])
  })

  it('过滤命中多个时仍按 sortKey 降序', () => {
    const D = mk({ name: '张伟', alias: '', msgCount: 500, lastContact: 2 })
    const r = filterSortFriends([A, B, C, D], '张', 'msgCount')
    expect(r.map((f) => f.name)).toEqual(['张伟', '张三'])
  })

  it('不修改传入数组（原顺序不变）', () => {
    const input = [A, B, C]
    filterSortFriends(input, '', 'msgCount')
    expect(input.map((f) => f.name)).toEqual(['张三', '李四', '王五'])
  })
})
