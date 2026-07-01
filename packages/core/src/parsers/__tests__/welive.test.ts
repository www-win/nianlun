import { describe, it, expect } from 'vitest'
import { weliveParser, sessionIdFromFileName, isServiceSession } from '../welive'
import { parseFile, aggregate, buildReport } from '../../index'

// 真实 WeLive 行的脱敏样本（字段顺序与真实导出一致）
const line = (o: Record<string, unknown>) => JSON.stringify({
  sort_seq: '1', create_time: '1782207175', local_id: '1', server_id: 'x',
  local_type: '1', real_sender_id: '1', message_content: '', sender_username: '',
  ...o,
})

describe('sessionIdFromFileName', () => {
  it('strips trailing _<8hex> and extension', () => {
    expect(sessionIdFromFileName('wxid_9n9z014h9axh22_caef54c8.jsonl')).toBe('wxid_9n9z014h9axh22')
    expect(sessionIdFromFileName('25032865050@chatroom_bb6fc02f.jsonl')).toBe('25032865050@chatroom')
  })
  it('falls back to base name when no hash suffix', () => {
    expect(sessionIdFromFileName('weird.jsonl')).toBe('weird')
  })
})

describe('isServiceSession', () => {
  it('flags official accounts and service ids', () => {
    expect(isServiceSession('gh_057d181d2822')).toBe(true)
    expect(isServiceSession('filehelper')).toBe(true)
    expect(isServiceSession('weixin')).toBe(true)
    expect(isServiceSession('notifymessage')).toBe(true)
  })
  it('keeps real contacts and groups', () => {
    expect(isServiceSession('wxid_abc')).toBe(false)
    expect(isServiceSession('123@chatroom')).toBe(false)
    expect(isServiceSession('123@openim')).toBe(false)
  })
})

describe('weliveParser.canParse', () => {
  it('accepts a WeLive jsonl first line', () => {
    expect(weliveParser.canParse('chat.jsonl', line({}))).toBe(true)
  })
  it('skips blank leading lines and a BOM', () => {
    expect(weliveParser.canParse('chat.jsonl', '﻿\n' + line({}))).toBe(true)
  })
  it('rejects a weflow message object', () => {
    const weflow = JSON.stringify({ talker: 'x', messages: [{ createTime: 1, isSender: 0 }] })
    expect(weliveParser.canParse('chat.json', weflow)).toBe(false)
  })
  it('rejects a nianlun friend-backup array', () => {
    expect(weliveParser.canParse('好友.json', '[{"name":"张三"}]')).toBe(false)
  })
})

describe('weliveParser.parse — private chat', () => {
  const content = [
    line({ create_time: '1782207175', local_type: '1', message_content: '你好', sender_username: 'wxid_peer' }),
    line({ create_time: '1782207200', local_type: '1', message_content: '在的', sender_username: '' }),
  ].join('\n')

  it('uses filename session id for id and peerName', () => {
    const { conversations } = weliveParser.parse(content, undefined, 'wxid_peer_aabbccdd.jsonl')
    expect(conversations).toHaveLength(1)
    expect(conversations[0].id).toBe('wxid_peer')
    expect(conversations[0].peerName).toBe('wxid_peer')
    expect(conversations[0].isGroup).toBe(false)
  })
  it('maps empty sender to me, non-empty to them', () => {
    const m = weliveParser.parse(content, undefined, 'wxid_peer_aabbccdd.jsonl').conversations[0].messages
    expect(m[0].from).toBe('them')
    expect(m[1].from).toBe('me')
  })
  it('单聊里我方消息带自己的真实 wxid（≠会话id）也判为 me', () => {
    // 真实 WeLive：我方 sender_username 是我的 wxid，不是空。对方 sender = 会话 id。
    const real = [
      line({ create_time: '1782207175', local_type: '1', message_content: '你好', sender_username: 'wxid_peer' }),
      line({ create_time: '1782207200', local_type: '1', message_content: '在的', sender_username: 'wxid_me' }),
    ].join('\n')
    const m = weliveParser.parse(real, undefined, 'wxid_peer_aabbccdd.jsonl').conversations[0].messages
    expect(m[0].from).toBe('them') // 对方 = 会话 id
    expect(m[1].from).toBe('me')   // 我的 wxid ≠ 会话 id
  })
  it('converts Unix seconds to milliseconds and keeps text', () => {
    const m = weliveParser.parse(content, undefined, 'wxid_peer_aabbccdd.jsonl').conversations[0].messages
    expect(m[0].ts).toBe(1782207175 * 1000)
    expect(m[0].text).toBe('你好')
  })
})

describe('weliveParser.parse — group chat', () => {
  const content = [
    line({ local_type: '1', message_content: 'wxid_a:\n收89', sender_username: 'wxid_a' }),
    line({ local_type: '1', message_content: '我发的', sender_username: '' }),
  ].join('\n')

  it('strips the <sender>:\\n prefix from group text', () => {
    const c = weliveParser.parse(content, undefined, '123@chatroom_aabbccdd.jsonl').conversations[0]
    expect(c.isGroup).toBe(true)
    expect(c.messages[0].text).toBe('收89')
    expect(c.messages[0].from).toBe('them')
    expect(c.messages[1].text).toBe('我发的')
    expect(c.messages[1].from).toBe('me')
  })
})

describe('weliveParser.parse — types & robustness', () => {
  it('maps base type from a composite local_type (49 | 62<<32)', () => {
    const content = line({ local_type: '266287972401', message_content: '不可读hex', sender_username: 'wxid_x' })
    const m = weliveParser.parse(content, undefined, 'wxid_x_aabbccdd.jsonl').conversations[0].messages
    expect(m[0].type).toBe('other')
    expect(m[0].text).toBe('') // 非文本不取 message_content
  })
  it('maps image/voice/system codes', () => {
    const content = [
      line({ local_type: '3', sender_username: 'wxid_x' }),
      line({ local_type: '34', sender_username: 'wxid_x' }),
      line({ local_type: '10000', sender_username: '' }),
    ].join('\n')
    const m = weliveParser.parse(content, undefined, 'wxid_x_aabbccdd.jsonl').conversations[0].messages
    expect(m[0].type).toBe('image')
    expect(m[1].type).toBe('voice')
    expect(m[2].type).toBe('system')
  })
  it('treats system messages (>=10000) as them even with empty sender', () => {
    const content = line({ local_type: '10000', message_content: '', sender_username: '' })
    const m = weliveParser.parse(content, undefined, 'wxid_x_aabbccdd.jsonl').conversations[0].messages
    expect(m[0].from).toBe('them')
  })
  it('skips bad/blank lines, collects warnings, never throws', () => {
    const content = ['{ not json', '', line({ message_content: 'ok', sender_username: 'wxid_x' })].join('\n')
    const res = weliveParser.parse(content, undefined, 'wxid_x_aabbccdd.jsonl')
    expect(res.conversations[0].messages).toHaveLength(1)
    expect(res.warnings.length).toBe(1)
  })
  it('skips a line with no valid timestamp', () => {
    const content = [
      JSON.stringify({ sort_seq: '1', local_type: '1', message_content: 'x', sender_username: 'wxid_x' }),
      line({ message_content: 'ok', sender_username: 'wxid_x' }),
    ].join('\n')
    const res = weliveParser.parse(content, undefined, 'wxid_x_aabbccdd.jsonl')
    expect(res.conversations[0].messages).toHaveLength(1)
    expect(res.warnings.length).toBe(1)
  })
})

describe('weliveParser.parse — service filtering', () => {
  it('returns empty and no warning for official-account sessions', () => {
    const content = line({ message_content: '广告', sender_username: 'gh_x' })
    const res = weliveParser.parse(content, undefined, 'gh_057d181d2822_ed9d1b80.jsonl')
    expect(res.conversations).toHaveLength(0)
    expect(res.warnings).toHaveLength(0)
  })
})

describe('welive end-to-end via parseFile', () => {
  const content = [
    line({ create_time: '1782207175', local_type: '1', message_content: '你好', sender_username: 'wxid_peer' }),
    line({ create_time: '1782207200', local_type: '1', message_content: '在的', sender_username: '' }),
  ].join('\n')

  it('dispatches jsonl to weliveParser using the filename', () => {
    const { conversations } = parseFile('wxid_peer_aabbccdd.jsonl', content)
    expect(conversations).toHaveLength(1)
    expect(conversations[0].peerName).toBe('wxid_peer')
  })

  it('parses → aggregates → builds report', () => {
    const { conversations } = parseFile('wxid_peer_aabbccdd.jsonl', content)
    const friends = aggregate(conversations)
    const report = buildReport(conversations, friends, 2026)
    expect(friends).toHaveLength(1)
    expect(friends[0].name).toBe('wxid_peer')
    expect(friends[0].sentRatio).toBe(50)
    expect(report.totalMessages).toBe(2)
  })
})
