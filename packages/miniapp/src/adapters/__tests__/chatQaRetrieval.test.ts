import { describe, it, expect } from 'vitest'
import { makeChatQaRetrieval } from '../chatQaRetrieval'
import type { Friend, ReportData } from '@nianlun/core'

function friend(p: Partial<Friend> & { id: string; name: string }): Friend {
  return {
    alias: '', rel: '其他', role: '', firstContact: 0, lastContact: 0,
    msgCount: 10, sentRatio: 50, peakPeriod: '', maxStreak: 0,
    monthly: new Array(12).fill(0), hourly: new Array(24).fill(0),
    weekHour: new Array(168).fill(0), keywords: [], userEdited: {}, ...p,
  } as Friend
}

const zhangsan = friend({ id: 'wxid_a', name: '张三', msgCount: 100 })
const lisi = friend({ id: 'wxid_b', name: '李四', msgCount: 50 })
const report: ReportData = {
  year: 2024, totalMessages: 150, friendCount: 2, activeDays: 30,
  topContacts: [{ friendId: 'wxid_a', msgCount: 100 }], latestMessage: null,
  keywords: [], relationBreakdown: [{ rel: '挚友', percent: 100 }],
}

// welive JSONL 原文：单聊里 sender===sessionId 为对方，空为我
// 注：weliveParser.canParse 靠首行是否含 sort_seq/create_time/local_type 这三个键嗅探格式
// （见 packages/core/src/parsers/welive.ts），故此处补上 sort_seq，否则 parseFile 识别不出格式。
const zhangsanFile = [
  JSON.stringify({ sort_seq: '1', create_time: 1709251200, local_type: 1, sender_username: 'wxid_a', message_content: '周末去吃火锅吧' }),
  JSON.stringify({ sort_seq: '2', create_time: 1709251260, local_type: 1, sender_username: '', message_content: '好啊几点' }),
].join('\n')

function fakeRaw(files: Record<string, string>) {
  return {
    list: () => Object.keys(files).map((name) => ({ name, size: files[name].length })),
    read: (name: string) => files[name] ?? '',
  }
}
const fakeSamples = { gatherTopSamples: () => ['我：在吗', '对方：在'] }

describe('chatQaRetrieval', () => {
  it('点名好友 → 从 rawStore 读原文、重解析成可读行放进 rawExcerpts', () => {
    const r = makeChatQaRetrieval({
      rawStore: fakeRaw({ 'wxid_a_00000001.jsonl': zhangsanFile }),
      samples: fakeSamples,
    })
    const { context, rawAvailable, wantedRaw } = r.retrieve('我和张三上次聊啥了', [zhangsan, lisi], report)
    expect(rawAvailable).toBe(true)
    expect(wantedRaw).toBe(true)
    expect(context.rawExcerpts).toHaveLength(1)
    expect(context.rawExcerpts[0].friend).toBe('张三')
    const joined = context.rawExcerpts[0].lines.join('\n')
    expect(joined).toContain('火锅')
    expect(joined).toContain('张三：')
    expect(joined).toContain('我：')
    expect(context.samples).toHaveLength(0)       // 命中原文时不再塞样本
    expect(context.statsSummary).toContain('2024')
  })

  it('泛问（未点名）→ 走样本 + 统计，rawExcerpts 为空', () => {
    const r = makeChatQaRetrieval({
      rawStore: fakeRaw({ 'wxid_a_00000001.jsonl': zhangsanFile }),
      samples: fakeSamples,
    })
    const { context, wantedRaw } = r.retrieve('我今年过得怎么样', [zhangsan, lisi], report)
    expect(wantedRaw).toBe(false)
    expect(context.rawExcerpts).toHaveLength(0)
    expect(context.samples.length).toBeGreaterThan(0)
  })

  it('rawStore 为空但点了名 → rawAvailable=false、wantedRaw=true、退回样本', () => {
    const r = makeChatQaRetrieval({ rawStore: fakeRaw({}), samples: fakeSamples })
    const { context, rawAvailable, wantedRaw } = r.retrieve('张三说过啥', [zhangsan], report)
    expect(rawAvailable).toBe(false)
    expect(wantedRaw).toBe(true)
    expect(context.rawExcerpts).toHaveLength(0)
    expect(context.samples.length).toBeGreaterThan(0)
  })
})
