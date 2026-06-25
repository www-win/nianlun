import { describe, it, expect } from 'vitest'
import { mapWeflowMessages } from '../weflow'
import sample from './fixtures/weflow-sample.json'

describe('mapWeflowMessages', () => {
  it('maps a private conversation with id/peerName/isGroup', () => {
    const { conversations } = mapWeflowMessages(sample)
    expect(conversations).toHaveLength(1)
    const c = conversations[0]
    expect(c.id).toBe('wxid_test001')
    expect(c.peerName).toBe('测试好友')
    expect(c.isGroup).toBe(false)
    expect(c.messages).toHaveLength(4)
  })

  it('converts Unix seconds to milliseconds', () => {
    const { conversations } = mapWeflowMessages(sample)
    expect(conversations[0].messages[0].ts).toBe(1704888000 * 1000)
  })

  it('maps isSender to from', () => {
    const m = mapWeflowMessages(sample).conversations[0].messages
    expect(m[0].from).toBe('them')
    expect(m[1].from).toBe('me')
  })

  it('maps WeChat type codes', () => {
    const m = mapWeflowMessages(sample).conversations[0].messages
    expect(m[0].type).toBe('text')
    expect(m[2].type).toBe('image')
    expect(m[3].type).toBe('voice')
  })

  it('detects group chat by @chatroom talker', () => {
    const { conversations } = mapWeflowMessages({
      talker: '123@chatroom', nickName: '群', messages: [
        { createTime: 1704888000, isSender: 0, type: 1, content: 'hi' },
      ],
    })
    expect(conversations[0].isGroup).toBe(true)
  })

  it('skips a message with no valid timestamp and records a warning', () => {
    const res = mapWeflowMessages({
      talker: 'x', nickName: 'X', messages: [
        { isSender: 0, type: 1, content: '坏消息' },
        { createTime: 1704888000, isSender: 1, type: 1, content: '好消息' },
      ],
    })
    expect(res.conversations[0].messages).toHaveLength(1)
    expect(res.warnings).toHaveLength(1)
  })

  it('returns empty + warning when messages array is missing', () => {
    const res = mapWeflowMessages({ talker: 'x', nickName: 'X' })
    expect(res.conversations).toHaveLength(0)
    expect(res.warnings).toHaveLength(1)
  })
})

import { weflowParser } from '../weflow'

describe('weflowParser.canParse', () => {
  const weflowSample = JSON.stringify({
    talker: 'wxid_1', nickName: '甲',
    messages: [{ createTime: 1704888000, isSender: 0, type: 1, content: 'hi' }],
  })

  it('accepts a WeFlow message JSON', () => {
    expect(weflowParser.canParse('chat.json', weflowSample)).toBe(true)
  })

  it('rejects nianlun friend-backup JSON (array of friends)', () => {
    const backup = JSON.stringify([{ name: '张三', rel: '同事', msgCount: 10 }])
    expect(weflowParser.canParse('好友信息.json', backup)).toBe(false)
  })

  it('rejects txt chat-log content', () => {
    expect(weflowParser.canParse('chat.txt', '2025-01-10 20:00:00 妈妈\n吃了吗')).toBe(false)
  })
})

describe('weflowParser.parse', () => {
  it('returns empty + warning on invalid JSON, never throws', () => {
    const res = weflowParser.parse('{ not json ')
    expect(res.conversations).toHaveLength(0)
    expect(res.warnings.length).toBeGreaterThan(0)
  })

  it('parses valid WeFlow JSON into conversations', () => {
    const content = JSON.stringify({
      talker: 'wxid_1', nickName: '甲',
      messages: [{ createTime: 1704888000, isSender: 1, type: 1, content: 'hi' }],
    })
    const res = weflowParser.parse(content)
    expect(res.conversations[0].messages[0].from).toBe('me')
  })
})
