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
