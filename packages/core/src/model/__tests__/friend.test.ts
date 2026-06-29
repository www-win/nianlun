import { describe, it, expect } from 'vitest'
import { createFriend } from '../friend'

describe('createFriend', () => {
  it('creates a Friend with zeroed numeric fields and default relation', () => {
    const f = createFriend('id-1', '周彤')
    expect(f.id).toBe('id-1')
    expect(f.name).toBe('周彤')
    expect(f.rel).toBe('其他')
    expect(f.msgCount).toBe(0)
    expect(f.monthly).toHaveLength(12)
    expect(f.monthly.every((n) => n === 0)).toBe(true)
    expect(f.userEdited).toEqual({})
  })
})

describe('createFriend 新统计字段', () => {
  it('初始化 hourly/weekHour/keywords', () => {
    const f = createFriend('a', 'A')
    expect(f.hourly).toHaveLength(24)
    expect(f.hourly.every((n) => n === 0)).toBe(true)
    expect(f.weekHour).toHaveLength(168)
    expect(f.weekHour.every((n) => n === 0)).toBe(true)
    expect(f.keywords).toEqual([])
  })
})
