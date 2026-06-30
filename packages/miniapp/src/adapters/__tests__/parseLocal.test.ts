import { describe, it, expect, vi } from 'vitest'
import { parseLocal } from '../parseLocal'

const TXT = `2025-01-02 10:00:00 张三
你好

2025-01-02 10:01:00 我
在的`

describe('parseLocal', () => {
  it('解析 txt 聚合出好友并产出报告与样本', () => {
    const out = parseLocal([{ name: 'chat.txt', content: TXT }], 2025)
    expect(out.report.year).toBe(2025)
    expect(out.friends.length).toBe(1)
    expect(out.friends[0].msgCount).toBe(2)
    expect(Object.keys(out.samples).length).toBe(1)
  })

  it('progress 回调随文件推进', () => {
    const onProgress = vi.fn()
    parseLocal([{ name: 'a.txt', content: TXT }], 2025, onProgress)
    expect(onProgress).toHaveBeenCalledWith(1)
  })

  it('无法识别的文件把告警收集进 warnings 而不抛', () => {
    const out = parseLocal([{ name: 'x.bin', content: '%%%' }], 2025)
    expect(out.warnings.some((w) => w.includes('x.bin'))).toBe(true)
  })
})
