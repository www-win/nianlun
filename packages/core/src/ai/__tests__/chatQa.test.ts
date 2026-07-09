import { describe, it, expect } from 'vitest'
import { selectRelevantFriends, extractKeywords, buildChatQaPrompt, parseChatQaAnswer } from '../chatQa'
import type { ChatQaContext, ChatQaTurn } from '../chatQa'

const friends = [
  { id: 'wxid_a', name: '张三', alias: '', role: '大学室友' },
  { id: 'wxid_b', name: '李四', alias: '四姐', role: '' },
  { id: 'wxid_c', name: '王五', alias: '', role: '' },
]

describe('selectRelevantFriends', () => {
  it('按 name 命中', () => {
    expect(selectRelevantFriends('我和张三上次聊什么了', friends)).toEqual(['wxid_a'])
  })
  it('按 alias 命中', () => {
    expect(selectRelevantFriends('四姐最近怎么样', friends)).toEqual(['wxid_b'])
  })
  it('按 role 命中', () => {
    expect(selectRelevantFriends('我大学室友是谁', friends)).toEqual(['wxid_a'])
  })
  it('无命中返回空', () => {
    expect(selectRelevantFriends('我今年过得怎么样', friends)).toEqual([])
  })
  it('去重：同一好友多字段命中只返回一次', () => {
    expect(selectRelevantFriends('李四也就是四姐', friends)).toEqual(['wxid_b'])
  })
})

describe('extractKeywords', () => {
  it('中文按 bigram 抽取、排除好友名', () => {
    const ks = extractKeywords('李四是不是提过要换工作', ['李四'])
    expect(ks).toContain('提过')
    expect(ks).toContain('工作')
    expect(ks).not.toContain('李四')     // 被 exclude
  })
  it('过滤常见功能性词（如「什么」）', () => {
    const ks = extractKeywords('他什么时候来的')
    expect(ks).not.toContain('什么')
  })
  it('字母数字取整词并小写', () => {
    const ks = extractKeywords('他发了个PDF')
    expect(ks).toContain('pdf')
  })
})

const ctx: ChatQaContext = {
  statsSummary: '年份2024；好友30位；全年消息1234条。',
  samples: ['我：在吗', '对方：在'],
  rawExcerpts: [{ friend: '张三', lines: ['2024-03-01 我：吃了吗', '2024-03-01 张三：吃了'] }],
}

describe('buildChatQaPrompt', () => {
  it('含规则、材料各区块与问题', () => {
    const p = buildChatQaPrompt('我和张三聊过啥', [], ctx)
    expect(p).toContain('不要编造')
    expect(p).toContain('没找到')
    expect(p).toContain('年份2024')
    expect(p).toContain('与张三的聊天')
    expect(p).toContain('2024-03-01 张三：吃了')
    expect(p).toContain('我和张三聊过啥')
  })
  it('拼接多轮对话历史', () => {
    const history: ChatQaTurn[] = [
      { role: 'user', text: '张三是谁' },
      { role: 'assistant', text: '你的大学室友' },
    ]
    const p = buildChatQaPrompt('那他呢', history, ctx)
    expect(p).toContain('用户：张三是谁')
    expect(p).toContain('助理：你的大学室友')
  })
  it('空样本/空原文时不报错，仍含问题', () => {
    const p = buildChatQaPrompt('随便问', [], { statsSummary: '', samples: [], rawExcerpts: [] })
    expect(p).toContain('随便问')
  })
})

describe('parseChatQaAnswer', () => {
  it('trim 首尾空白', () => {
    expect(parseChatQaAnswer('  答案  \n')).toBe('答案')
  })
})
