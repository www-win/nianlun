import { describe, it, expect } from 'vitest'
import { buildReport } from '../report'
import { aggregate } from '../aggregate'
import type { Conversation } from '../../model/types'

const t = (s: string) => new Date(s).getTime()
const convs: Conversation[] = [
  { id: '妈妈', peerName: '妈妈', isGroup: false, messages: [
    { ts: t('2025-01-01T20:00:00'), from: 'them', type: 'text', text: '吃了吗' },
    { ts: t('2025-01-02T20:00:00'), from: 'me', type: 'text', text: '吃了' },
  ]},
  { id: '周彤', peerName: '周彤', isGroup: false, messages: [
    { ts: t('2025-03-14T02:47:00'), from: 'me', type: 'text', text: '到家了' },
  ]},
]

describe('buildReport', () => {
  it('computes report fields', () => {
    const friends = aggregate(convs)
    const r = buildReport(convs, friends, 2025)
    expect(r.totalMessages).toBe(3)
    expect(r.friendCount).toBe(2)
    expect(r.activeDays).toBe(3) // 1/1, 1/2, 3/14
    expect(r.topContacts[0].friendId).toBe('妈妈') // 2 条最多
    expect(r.latestMessage?.friendId).toBe('周彤') // 3/14 最晚
    const fam = r.relationBreakdown.find((x) => x.rel === '其他')
    expect(fam).toBeTruthy()
  })
})
