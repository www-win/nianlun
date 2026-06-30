import { describe, it, expect } from 'vitest'
import { aggregate, buildReport } from '@nianlun/core'

describe('miniapp 能消费 core', () => {
  it('aggregate 空会话返回空数组', () => {
    expect(aggregate([])).toEqual([])
  })
  it('buildReport 返回带 year 的报告', () => {
    const r = buildReport([], [], 2025)
    expect(r.year).toBe(2025)
  })
})
