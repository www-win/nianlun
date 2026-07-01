import { describe, it, expect, vi } from 'vitest'
import type { Conversation } from '@nianlun/core'
import { parseLocal, computeRecentInsights } from '../parseLocal'

const DAY = 86400000

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

describe('computeRecentInsights（最近一个月：以最新一条消息为基准往前 30 天）', () => {
  const now = 1000 * DAY
  const convs: Conversation[] = [
    {
      id: 'f1', peerName: '张三', isGroup: false,
      messages: [
        { ts: now - 40 * DAY, from: 'them', type: 'text', text: '旧消息旧消息' }, // 窗口外
        { ts: now - 5 * DAY, from: 'them', type: 'text', text: '新消息新消息' },   // 窗口内
        { ts: now, from: 'me', type: 'text', text: '最新最新' },                   // 窗口内(= maxTs)
      ],
    },
    {
      id: 'f2', peerName: '李四', isGroup: false,
      messages: [
        { ts: now - 60 * DAY, from: 'them', type: 'text', text: '很久以前很久以前' }, // 全在窗口外
      ],
    },
  ]

  it('只保留窗口内消息用于 keywords/weekHour/samples', () => {
    const { recentInsights, recentSamples } = computeRecentInsights(convs)
    // f1 窗口内 2 条：weekHour 总和 = 2，样本 2 条，且不含旧消息文本
    const sum = recentInsights.f1.weekHour.reduce((a, b) => a + b, 0)
    expect(sum).toBe(2)
    expect(recentSamples.f1).toHaveLength(2)
    expect(recentSamples.f1.some((s) => s.includes('旧消息'))).toBe(false)
    expect(recentInsights.f1.keywords.some((k) => k.word.includes('旧消息'))).toBe(false)
  })

  it('窗口内无消息的好友被排除', () => {
    const { recentInsights, recentSamples } = computeRecentInsights(convs)
    expect(recentInsights.f2).toBeUndefined()
    expect(recentSamples.f2).toBeUndefined()
  })

  it('没有任何带时间戳的消息时返回空对象', () => {
    expect(computeRecentInsights([])).toEqual({ recentInsights: {}, recentSamples: {} })
  })
})
