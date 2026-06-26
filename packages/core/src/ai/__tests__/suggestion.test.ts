import { describe, it, expect } from 'vitest'
import type { Conversation, Friend } from '../../model/types'
import {
  extractFriendSamples,
  buildFriendSuggestionPrompt,
  parseFriendSuggestion,
} from '../suggestion'

function textMsg(ts: number, from: 'me' | 'them', text: string): Conversation['messages'][number] {
  return { ts, from, type: 'text', text }
}

describe('extractFriendSamples', () => {
  it('键为会话 id（= friend id）', () => {
    const convs: Conversation[] = [
      { id: 'c1', peerName: '甲', isGroup: false, messages: [textMsg(1, 'them', '你好')] },
      { id: 'c2', peerName: '乙', isGroup: false, messages: [textMsg(1, 'me', '在吗')] },
    ]
    const out = extractFriendSamples(convs)
    expect(Object.keys(out).sort()).toEqual(['c1', 'c2'])
  })

  it('过滤非 text 与空 text', () => {
    const convs: Conversation[] = [
      {
        id: 'c1', peerName: '甲', isGroup: false,
        messages: [
          textMsg(1, 'them', '真实文本'),
          { ts: 2, from: 'me', type: 'image' },
          { ts: 3, from: 'me', type: 'text', text: '   ' },
          { ts: 4, from: 'me', type: 'text', text: '' },
          { ts: 5, from: 'them', type: 'voice' },
        ],
      },
    ]
    const out = extractFriendSamples(convs)
    expect(out.c1).toHaveLength(1)
    expect(out.c1[0]).toContain('真实文本')
  })

  it('每个好友最多 maxPerFriend 条', () => {
    const messages = Array.from({ length: 50 }, (_, i) => textMsg(i + 1, 'me', `m${i}`))
    const convs: Conversation[] = [{ id: 'c1', peerName: '甲', isGroup: false, messages }]
    const out = extractFriendSamples(convs, { maxPerFriend: 30 })
    expect(out.c1).toHaveLength(30)
  })

  it('单条文本截断到 maxChars', () => {
    const convs: Conversation[] = [
      { id: 'c1', peerName: '甲', isGroup: false, messages: [textMsg(1, 'them', 'a'.repeat(200))] },
    ]
    const out = extractFriendSamples(convs, { maxChars: 80 })
    const run = out.c1[0].match(/a+/)![0]
    expect(run).toHaveLength(80)
  })

  it('样本标注收发方向', () => {
    const convs: Conversation[] = [
      {
        id: 'c1', peerName: '甲', isGroup: false,
        messages: [textMsg(1, 'me', '我说的'), textMsg(2, 'them', '对方说的')],
      },
    ]
    const out = extractFriendSamples(convs)
    expect(out.c1.some((s) => s.includes('我') && s.includes('我说的'))).toBe(true)
    expect(out.c1.some((s) => s.includes('对方') && s.includes('对方说的'))).toBe(true)
  })
})

const friend: Friend = {
  id: 'f1', name: '阿强', alias: '', rel: '其他', role: '',
  firstContact: 1700000000000, lastContact: 1730000000000, msgCount: 820, sentRatio: 65,
  peakPeriod: '深夜', maxStreak: 14, monthly: new Array(12).fill(5), userEdited: {},
}

describe('buildFriendSuggestionPrompt', () => {
  it('含好友名、统计与样本片段', () => {
    const p = buildFriendSuggestionPrompt(friend, ['对方：周末一起去爬山吧'])
    expect(p).toContain('阿强')
    expect(p).toContain('820')
    expect(p).toContain('周末一起去爬山吧')
  })

  it('要求只输出严格 JSON，含 rel/role/reason 与六个关系取值', () => {
    const p = buildFriendSuggestionPrompt(friend, ['对方：在吗'])
    expect(p).toContain('JSON')
    expect(p).toContain('只输出')
    expect(p).toContain('rel')
    expect(p).toContain('role')
    expect(p).toContain('reason')
    for (const r of ['家人', '挚友', '同事', '同学', '客户', '其他']) {
      expect(p).toContain(r)
    }
  })

  it('alias 优先于 name', () => {
    const p = buildFriendSuggestionPrompt({ ...friend, alias: '强哥' }, ['对方：在吗'])
    expect(p).toContain('强哥')
  })

  it('无样本时仍可生成（标注无样本）', () => {
    const p = buildFriendSuggestionPrompt(friend, [])
    expect(p).toContain('阿强')
  })
})

describe('parseFriendSuggestion', () => {
  it('解析纯 JSON', () => {
    const r = parseFriendSuggestion('{"rel":"同事","role":"产品经理","reason":"经常聊需求"}')
    expect(r).toEqual({ rel: '同事', role: '产品经理', reason: '经常聊需求' })
  })

  it('剥除 ```json 围栏', () => {
    const r = parseFriendSuggestion('```json\n{"rel":"挚友","role":"","reason":"无话不谈"}\n```')
    expect(r.rel).toBe('挚友')
    expect(r.reason).toBe('无话不谈')
  })

  it('容忍 JSON 前后的多余文字', () => {
    const r = parseFriendSuggestion('根据分析：\n{"rel":"客户","role":"采购"}\n以上仅供参考。')
    expect(r.rel).toBe('客户')
    expect(r.role).toBe('采购')
  })

  it('非法 rel 被丢弃，保留 role/reason', () => {
    const r = parseFriendSuggestion('{"rel":"路人","role":"快递员","reason":"只聊取件"}')
    expect(r.rel).toBeUndefined()
    expect(r.role).toBe('快递员')
    expect(r.reason).toBe('只聊取件')
  })

  it('对 role/reason 做 trim', () => {
    const r = parseFriendSuggestion('{"rel":"同学","role":"  班长  ","reason":" 一起上学 "}')
    expect(r.role).toBe('班长')
    expect(r.reason).toBe('一起上学')
  })

  it('垃圾输入返回 {} 不抛异常', () => {
    expect(parseFriendSuggestion('完全不是 JSON')).toEqual({})
    expect(parseFriendSuggestion('')).toEqual({})
    expect(parseFriendSuggestion('{坏的')).toEqual({})
  })
})
