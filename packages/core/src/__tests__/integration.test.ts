import { describe, it, expect } from 'vitest'
import { parseFile, aggregate, buildReport } from '../index'

const SAMPLE = `2025-01-10 20:00:00 妈妈
吃了吗

2025-01-10 20:01:00 我
吃了

2025-03-14 02:47:00 妈妈
早点睡`

describe('core end-to-end', () => {
  it('parses → aggregates → builds report', () => {
    const { conversations } = parseFile('家庭群.txt', SAMPLE)
    const friends = aggregate(conversations)
    const report = buildReport(conversations, friends, 2025)
    expect(friends).toHaveLength(1)
    expect(friends[0].name).toBe('妈妈')
    expect(report.totalMessages).toBe(3)
    expect(report.activeDays).toBe(2)
  })
})
