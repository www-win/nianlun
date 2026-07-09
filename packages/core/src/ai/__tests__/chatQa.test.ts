import { describe, it, expect } from 'vitest'
import { selectRelevantFriends, extractKeywords } from '../chatQa'

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
  it('抽取 2 字以上中文/字母数字词，去停用词', () => {
    const ks = extractKeywords('李四是不是提过要换工作', ['李四'])
    expect(ks).toContain('提过')
    expect(ks).toContain('要换工作')
    expect(ks).not.toContain('李四')     // 被 exclude
  })
  it('过滤单字与停用词', () => {
    const ks = extractKeywords('他什么时候来的')
    expect(ks).not.toContain('什么')
  })
})
