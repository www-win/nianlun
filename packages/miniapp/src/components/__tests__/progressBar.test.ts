import { describe, it, expect } from 'vitest'
import { resolveProgress, stepProgress } from '../progressBarLogic'

describe('resolveProgress', () => {
  it('传 percent → determinate，width 为该值', () => {
    expect(resolveProgress({ percent: 40 })).toEqual({ mode: 'determinate', width: 40, showLabel: false })
  })
  it('percent 越界被夹到 0..100', () => {
    expect(resolveProgress({ percent: -5 }).width).toBe(0)
    expect(resolveProgress({ percent: 150 }).width).toBe(100)
  })
  it('percent 优先于 indeterminate', () => {
    expect(resolveProgress({ percent: 20, indeterminate: true }).mode).toBe('determinate')
  })
  it('只有 indeterminate → 动画态，width 40', () => {
    expect(resolveProgress({ indeterminate: true })).toEqual({ mode: 'indeterminate', width: 40, showLabel: false })
  })
  it('都不传 → empty', () => {
    expect(resolveProgress({}).mode).toBe('empty')
  })
  it('label 非空 → showLabel true', () => {
    expect(resolveProgress({ percent: 10, label: '分析中 1/3' }).showLabel).toBe(true)
    expect(resolveProgress({ percent: 10, label: '' }).showLabel).toBe(false)
  })
})

describe('stepProgress', () => {
  it('从 0 出发会向前推进', () => {
    expect(stepProgress(0)).toBeGreaterThan(0)
  })
  it('越接近 cap 步子越小（指数逼近）', () => {
    const early = stepProgress(0) - 0
    const late = stepProgress(80) - 80
    expect(late).toBeLessThan(early)
  })
  it('永不超过 cap', () => {
    expect(stepProgress(89.99)).toBeLessThanOrEqual(90)
    expect(stepProgress(200)).toBeLessThanOrEqual(90)
  })
  it('多次迭代单调逼近 cap', () => {
    let p = 0
    for (let i = 0; i < 200; i++) p = stepProgress(p)
    expect(p).toBeGreaterThan(85)
    expect(p).toBeLessThanOrEqual(90)
  })
})
