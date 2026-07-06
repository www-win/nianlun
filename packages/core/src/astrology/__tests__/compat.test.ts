import { describe, it, expect } from 'vitest'
import { isBranchClash, isBranchHarmony, getCompatibility } from '../compat'
import { buildBaziChart } from '../chart'

describe('地支冲合对照表', () => {
  it('子午相冲、无关顺序', () => {
    expect(isBranchClash('子', '午')).toBe(true)
    expect(isBranchClash('午', '子')).toBe(true)
    expect(isBranchClash('子', '丑')).toBe(false)
  })
  it('子丑六合、寅亥六合', () => {
    expect(isBranchHarmony('子', '丑')).toBe(true)
    expect(isBranchHarmony('寅', '亥')).toBe(true)
    expect(isBranchHarmony('子', '午')).toBe(false)
  })
})

describe('getCompatibility', () => {
  it('鼠年(1984) × 马年(1990)：年支子午相冲 → clashes 非空', () => {
    const a = buildBaziChart({ year: 1984, month: 6, day: 1 })  // 子(鼠)
    const b = buildBaziChart({ year: 1990, month: 6, day: 1 })  // 午(马)
    const c = getCompatibility(a, b)
    expect(c.clashes.length).toBeGreaterThan(0)
  })
  it('返回结构含 harmonies / clashes 数组', () => {
    const a = buildBaziChart({ year: 1990, month: 6, day: 1 })
    const c = getCompatibility(a, a)
    expect(Array.isArray(c.harmonies)).toBe(true)
    expect(Array.isArray(c.clashes)).toBe(true)
  })
})
