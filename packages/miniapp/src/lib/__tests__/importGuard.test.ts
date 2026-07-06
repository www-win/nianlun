import { describe, it, expect } from 'vitest'
import { assessImportSize } from '../importGuard'

describe('assessImportSize', () => {
  it('小数据不触发提示', () => {
    const r = assessImportSize([{ name: 'wxid_a.jsonl', content: 'x'.repeat(1000) }])
    expect(r.warn).toBe(false)
    expect(r.count).toBe(1)
  })
  it('总字节超 50MB 触发提示', () => {
    const big = 'x'.repeat(51 * 1024 * 1024)
    const r = assessImportSize([{ name: 'wxid_a.jsonl', content: big }])
    expect(r.warn).toBe(true)
    expect(Math.round(r.sizeMB)).toBe(51)
  })
  it('有效文件数超 50 触发提示', () => {
    const files = Array.from({ length: 51 }, (_, i) => ({ name: `wxid_${i}.jsonl`, content: 'x' }))
    const r = assessImportSize(files)
    expect(r.warn).toBe(true)
    expect(r.count).toBe(51)
  })
  it('公众号/系统会话不计入体量', () => {
    const files = Array.from({ length: 60 }, (_, i) => ({ name: `gh_${i}.jsonl`, content: 'x' }))
    const r = assessImportSize(files)
    expect(r.warn).toBe(false)
    expect(r.count).toBe(0)
  })
})
