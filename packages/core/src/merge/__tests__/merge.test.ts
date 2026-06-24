import { describe, it, expect } from 'vitest'
import { mergeConversations, mergeFriends } from '../merge'
import { createFriend } from '../../model/friend'
import type { Conversation } from '../../model/types'

const t = (s: string) => new Date(s).getTime()

describe('mergeConversations', () => {
  it('merges same peer and dedupes identical messages', () => {
    const a: Conversation[] = [{ id: '周彤', peerName: '周彤', isGroup: false, messages: [
      { ts: t('2025-01-01T10:00:00'), from: 'them', type: 'text', text: '你好' },
    ]}]
    const b: Conversation[] = [{ id: '周彤', peerName: '周彤', isGroup: false, messages: [
      { ts: t('2025-01-01T10:00:00'), from: 'them', type: 'text', text: '你好' }, // 重复
      { ts: t('2025-01-02T10:00:00'), from: 'me', type: 'text', text: '在' },
    ]}]
    const merged = mergeConversations(a, b)
    expect(merged).toHaveLength(1)
    expect(merged[0].messages).toHaveLength(2) // 去重后 2 条
  })
})

describe('mergeFriends', () => {
  it('keeps user edits but updates stats', () => {
    const existing = createFriend('周彤', '周彤')
    existing.role = '大学室友'
    existing.rel = '挚友'
    existing.userEdited = { role: '大学室友', rel: '挚友' }
    existing.msgCount = 100

    const incoming = createFriend('周彤', '周彤')
    incoming.role = '' // 新导入没有职务
    incoming.msgCount = 150

    const { friends, added, updated } = mergeFriends([existing], [incoming])
    expect(added).toBe(0)
    expect(updated).toBe(1)
    expect(friends[0].msgCount).toBe(150)   // 统计用新值
    expect(friends[0].role).toBe('大学室友') // 用户编辑保留
    expect(friends[0].rel).toBe('挚友')
  })

  it('adds brand-new friends', () => {
    const { friends, added } = mergeFriends([], [createFriend('新朋友', '新朋友')])
    expect(added).toBe(1)
    expect(friends).toHaveLength(1)
  })
})
