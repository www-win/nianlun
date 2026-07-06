import { describe, it, expect } from 'vitest'
import { mergeConversations, mergeFriends, applyContactNames } from '../merge'
import { createFriend } from '../../model/friend'
import type { Conversation } from '../../model/types'
import type { FriendEmotion } from '../../model/types'

const emo = (total: number): FriendEmotion => ({
  me: { happy: total, neutral: 0, sad: 0, total, avg: 1 },
  them: { happy: 0, neutral: 0, sad: 0, total: 0, avg: 0.5 },
  monthly: { me: [{ avg: 1, count: total }, ...Array(11).fill(null)], them: Array(12).fill(null) },
  words: [{ word: '开心', count: total, polarity: 1 }],
})

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

  it('keeps a contact-applied name across re-import (userEdited.name)', () => {
    const existing = createFriend('wxid_a', '张兴国') // 联系人套名后
    existing.userEdited = { name: '张兴国' }
    existing.msgCount = 100

    const incoming = createFriend('wxid_a', 'wxid_a') // 重新导入 jsonl，name 退回 wxid
    incoming.msgCount = 150

    const { friends } = mergeFriends([existing], [incoming])
    expect(friends[0].msgCount).toBe(150)  // 统计用新值
    expect(friends[0].name).toBe('张兴国')  // 套用的名字保留
  })
})

describe('mergeFriends emotion', () => {
  it('同 id 两侧都有 emotion → 计数相加', () => {
    const a = { ...createFriend('X', 'X'), emotion: emo(2), keywords: [{ word: '开心', count: 5 }] }
    const b = { ...createFriend('X', 'X'), emotion: emo(3), keywords: [{ word: '开心', count: 5 }] }
    const { friends } = mergeFriends([a], [b])
    expect(friends[0].emotion!.me.total).toBe(5)
    expect(friends[0].emotion!.monthly.me[0]!.count).toBe(5)
  })
  it('仅 incoming 有 emotion → 取 incoming', () => {
    const a = createFriend('Y', 'Y')                       // 无 emotion
    const b = { ...createFriend('Y', 'Y'), emotion: emo(2) }
    const { friends } = mergeFriends([a], [b])
    expect(friends[0].emotion!.me.total).toBe(2)
  })
})

describe('applyContactNames', () => {
  it('sets name and userEdited.name for matched friends', () => {
    const friends = [createFriend('wxid_a', 'wxid_a'), createFriend('25032865050@chatroom', '25032865050@chatroom')]
    const out = applyContactNames(friends, [
      { id: 'wxid_a', name: '张兴国' },
      { id: '25032865050@chatroom', name: '校园集市燕大24站' },
    ])
    expect(out[0].name).toBe('张兴国')
    expect(out[0].userEdited.name).toBe('张兴国')
    expect(out[1].name).toBe('校园集市燕大24站')
    expect(out[1].userEdited.name).toBe('校园集市燕大24站')
  })

  it('leaves unmatched friends unchanged', () => {
    const friends = [createFriend('wxid_x', 'wxid_x')]
    const out = applyContactNames(friends, [{ id: 'wxid_other', name: '别人' }])
    expect(out[0].name).toBe('wxid_x')
    expect(out[0].userEdited.name).toBeUndefined()
  })

  it('does not mutate the input array elements', () => {
    const friends = [createFriend('wxid_a', 'wxid_a')]
    applyContactNames(friends, [{ id: 'wxid_a', name: '小明' }])
    expect(friends[0].name).toBe('wxid_a') // 原对象不变
  })
})
