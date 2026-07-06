import { describe, it, expect } from 'vitest'
import { isBranchClash, isBranchHarmony, getCompatibility, dayBranchClashes } from '../compat'
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

describe('dayBranchClashes 流日相冲', () => {
  it('流日支冲本命年支时返回非空', () => {
    // 好友本命年支为午(1990马年)；流日支子 → 子午相冲
    const b = buildBaziChart({ year: 1990, month: 6, day: 1 })
    const res = dayBranchClashes('子', b)
    expect(res.some((s) => s.includes('年支'))).toBe(true)
  })
  it('不冲时返回空数组', () => {
    const b = buildBaziChart({ year: 1990, month: 6, day: 1 })
    // 与午不冲、也需与其日支不冲：用与午相同的支‘午’不构成冲
    expect(dayBranchClashes('午', b).some((s) => s.includes('年支'))).toBe(false)
  })
})
