import { describe, it, expect } from 'vitest'
import { sumHourly, sumWeekHour, mergeKeywords } from '../global'
import { createFriend } from '../../model/friend'

function fr(over: Partial<ReturnType<typeof createFriend>>) {
  return { ...createFriend('x', 'x'), ...over }
}

describe('global 派生', () => {
  it('sumHourly 逐位求和', () => {
    const a = fr({ hourly: Array.from({ length: 24 }, (_, i) => (i === 9 ? 2 : 0)) })
    const b = fr({ hourly: Array.from({ length: 24 }, (_, i) => (i === 9 ? 3 : 0)) })
    expect(sumHourly([a, b])[9]).toBe(5)
  })
  it('sumWeekHour 逐位求和', () => {
    const a = fr({ weekHour: Array.from({ length: 168 }, (_, i) => (i === 34 ? 1 : 0)) })
    const b = fr({ weekHour: Array.from({ length: 168 }, (_, i) => (i === 34 ? 4 : 0)) })
    expect(sumWeekHour([a, b])[34]).toBe(5)
  })
  it('mergeKeywords 合并计数并取 topN', () => {
    const a = fr({ keywords: [{ word: '开会', count: 3 }, { word: '吃饭', count: 1 }] })
    const b = fr({ keywords: [{ word: '开会', count: 2 }] })
    expect(mergeKeywords([a, b], 1)).toEqual([{ word: '开会', count: 5 }])
  })
})
