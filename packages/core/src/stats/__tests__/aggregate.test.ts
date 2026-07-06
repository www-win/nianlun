import { describe, it, expect } from 'vitest'
import { aggregate } from '../aggregate'
import type { Conversation } from '../../model/types'

const t = (s: string) => new Date(s).getTime()

const conv: Conversation = {
  id: '周彤', peerName: '周彤', isGroup: false,
  messages: [
    { ts: t('2025-01-10T10:00:00'), from: 'them', type: 'text', text: '在吗' },
    { ts: t('2025-01-10T10:01:00'), from: 'me', type: 'text', text: '在' },
    { ts: t('2025-03-14T02:47:00'), from: 'me', type: 'text', text: '到家了' },
  ],
}

describe('aggregate', () => {
  it('produces one friend per conversation with correct stats', () => {
    const friends = aggregate([conv])
    expect(friends).toHaveLength(1)
    const f = friends[0]
    expect(f.name).toBe('周彤')
    expect(f.msgCount).toBe(3)
    expect(f.sentRatio).toBe(67) // 2/3 我方 ≈ 67%
    expect(f.firstContact).toBe(t('2025-01-10T10:00:00'))
    expect(f.lastContact).toBe(t('2025-03-14T02:47:00'))
    expect(f.monthly[0]).toBe(2) // 1 月 2 条
    expect(f.monthly[2]).toBe(1) // 3 月 1 条
  })
})

describe('aggregate 最长连续聊天天数', () => {
  it('按有消息的日期算最长连续天数，同一天多条不重复计', () => {
    const c: Conversation = {
      id: 'S', peerName: 'S', isGroup: false,
      messages: [
        { ts: t('2025-01-10T10:00:00'), from: 'them', type: 'text', text: 'a' },
        { ts: t('2025-01-11T09:00:00'), from: 'me', type: 'text', text: 'b' },
        { ts: t('2025-01-11T20:00:00'), from: 'me', type: 'text', text: 'b2' }, // 同天
        { ts: t('2025-01-12T08:00:00'), from: 'them', type: 'text', text: 'c' },
        { ts: t('2025-03-14T02:00:00'), from: 'me', type: 'text', text: 'd' },   // 断开
      ],
    }
    expect(aggregate([c])[0].maxStreak).toBe(3)
  })
})

describe('aggregate 活跃时段(peakPeriod)', () => {
  const at = (hour: number): Conversation => ({
    id: 'P', peerName: 'P', isGroup: false,
    messages: [
      { ts: t(`2025-01-10T${String(hour).padStart(2, '0')}:00:00`), from: 'me', type: 'text', text: 'x' },
      { ts: t(`2025-01-11T${String(hour).padStart(2, '0')}:30:00`), from: 'me', type: 'text', text: 'y' },
    ],
  })
  it('把峰值小时映射成中文时段标签', () => {
    expect(aggregate([at(20)])[0].peakPeriod).toBe('晚上') // 19–23
    expect(aggregate([at(2)])[0].peakPeriod).toBe('凌晨')  // 0–5
    expect(aggregate([at(10)])[0].peakPeriod).toBe('上午') // 6–11
    expect(aggregate([at(15)])[0].peakPeriod).toBe('下午') // 14–18
  })
  it('无消息时为空字符串', () => {
    expect(aggregate([{ id: 'E', peerName: 'E', isGroup: false, messages: [] }])[0].peakPeriod).toBe('')
  })
})

describe('aggregate 时段/热力/词频', () => {
  it('按小时与星期分桶，并算词频', () => {
    const c = {
      id: 'A', peerName: 'A', isGroup: false,
      messages: [
        // 2025-01-06 是周一，10 点
        { ts: t('2025-01-06T10:00:00'), from: 'them' as const, type: 'text' as const, text: '今天开会' },
        { ts: t('2025-01-06T10:30:00'), from: 'me' as const, type: 'text' as const, text: '好的开会' },
      ],
    }
    const f = aggregate([c])[0]
    expect(f.hourly[10]).toBe(2)
    // 周一 getDay()===1 → 索引 1*24+10 = 34
    expect(f.weekHour[34]).toBe(2)
    expect(f.keywords[0]).toEqual({ word: '开会', count: 2 })
  })
})

describe('aggregate emotion', () => {
  function conv(messages: Conversation['messages']): Conversation {
    return { id: 'A', peerName: 'A', isGroup: false, messages }
  }
  const ts = (month: number) => new Date(2026, month - 1, 15, 12).getTime() // month 1..12

  it('按 me/them 两侧聚合分布', () => {
    const [f] = aggregate([conv([
      { ts: ts(1), from: 'me', type: 'text', text: '好开心哈哈' },
      { ts: ts(1), from: 'them', type: 'text', text: '好难受烦' },
      { ts: ts(1), from: 'them', type: 'text', text: '在吗' },
    ])])
    expect(f.emotion!.me.happy).toBe(1)
    expect(f.emotion!.them.sad).toBe(1)
    expect(f.emotion!.them.total).toBe(2)
  })

  it('monthly 无消息月为 null、有消息月带 count', () => {
    const [f] = aggregate([conv([
      { ts: ts(3), from: 'me', type: 'text', text: '开心' },
    ])])
    expect(f.emotion!.monthly.me[0]).toBeNull()      // 1 月无
    expect(f.emotion!.monthly.me[2]).toMatchObject({ count: 1 }) // 3 月有
  })

  it('words 带极性（高频正词>0）', () => {
    const msgs = Array.from({ length: 5 }, () => ({ ts: ts(1), from: 'me' as const, type: 'text' as const, text: '开心' }))
    const [f] = aggregate([conv(msgs)])
    const w = f.emotion!.words.find((x) => x.word === '开心')
    expect(w && w.polarity).toBeGreaterThan(0)
  })

  it('无消息好友：emotion 两侧 total 0、avg 0.5、monthly 全 null', () => {
    const [f] = aggregate([conv([])])
    expect(f.emotion!.me.total).toBe(0)
    expect(f.emotion!.me.avg).toBeCloseTo(0.5)
    expect(f.emotion!.monthly.me.every((m) => m === null)).toBe(true)
  })

  it('非文本消息（图片/语音等）不计入情绪分布 total', () => {
    const [f] = aggregate([conv([
      { ts: ts(1), from: 'me', type: 'text', text: '好开心哈哈' },
      { ts: ts(1), from: 'me', type: 'image' },            // 无 text，不计入
      { ts: ts(1), from: 'me', type: 'text', text: '' },   // 空 text，不计入
    ])])
    expect(f.emotion!.me.total).toBe(1)        // 只有那条文本
    expect(f.emotion!.me.happy).toBe(1)        // 分布只反映那条文本
    expect(f.emotion!.me.neutral).toBe(0)
    expect(f.emotion!.monthly.me[0]!.count).toBe(1)
  })

  it('全是媒体消息的好友：两侧 total 0、avg 0.5 兜底、monthly 全 null', () => {
    const [f] = aggregate([conv([
      { ts: ts(2), from: 'me', type: 'image' },
      { ts: ts(2), from: 'them', type: 'voice' },
    ])])
    expect(f.emotion!.me.total).toBe(0)
    expect(f.emotion!.them.total).toBe(0)
    expect(f.emotion!.me.avg).toBeCloseTo(0.5)
    expect(f.emotion!.monthly.me.every((m) => m === null)).toBe(true)
    expect(f.emotion!.monthly.them.every((m) => m === null)).toBe(true)
  })
})
