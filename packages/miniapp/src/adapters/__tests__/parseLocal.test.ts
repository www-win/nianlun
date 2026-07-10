import { describe, it, expect } from 'vitest'
import type { Conversation } from '@nianlun/core'
import { parseLocal, computeRecentInsights, type ParseProgress } from '../parseLocal'

const DAY = 86400000

const TXT = `2025-01-02 10:00:00 张三
你好

2025-01-02 10:01:00 我
在的`

describe('parseLocal', () => {
  it('解析 txt 聚合出好友并产出报告与样本', async () => {
    const out = await parseLocal([{ name: 'chat.txt', content: TXT }], 2025)
    expect(out.report.year).toBe(2025)
    expect(out.friends.length).toBe(1)
    expect(out.friends[0].msgCount).toBe(2)
    expect(Object.keys(out.samples).length).toBe(1)
  })

  it('progress 回调带阶段推进：解析到满，末尾聚合', async () => {
    const calls: ParseProgress[] = []
    await parseLocal([{ name: 'a.txt', content: TXT }], 2025, (p) => calls.push(p))
    expect(calls).toContainEqual({ phase: 'parsing', done: 1, total: 1 })
    expect(calls[calls.length - 1].phase).toBe('aggregating')
  })

  it('无法识别的文件把告警收集进 warnings 而不抛', async () => {
    const out = await parseLocal([{ name: 'x.bin', content: '%%%' }], 2025)
    expect(out.warnings.some((w) => w.includes('x.bin'))).toBe(true)
  })

  it('样本每人上限 60 条，单条不超过 120 字', async () => {
    const lines: string[] = []
    for (let i = 0; i < 80; i++) {
      lines.push(`2025-03-01 10:${String(i % 60).padStart(2, '0')}:00 张三`)
      lines.push('内'.repeat(200)) // 200 字，超过 120
      lines.push('')
    }
    const out = await parseLocal([{ name: '张三.txt', content: lines.join('\n') }], 2025)
    const s = Object.values(out.samples)[0]
    expect(s.length).toBeLessThanOrEqual(60)
    expect(s.length).toBeGreaterThan(30) // 证明确实放大了（默认 30 会正好卡 30）
    for (const line of s) expect(line.length).toBeLessThanOrEqual(120 + 3) // 「对方：」前缀约 3 字
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
