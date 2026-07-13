import { describe, it, expect } from 'vitest'
import { resolveProgress } from '../progressBarLogic'

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
