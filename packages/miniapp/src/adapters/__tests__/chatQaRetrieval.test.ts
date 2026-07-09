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

// welive JSONL 行：单聊里 sender===sessionId 为对方、空为我；canParse 靠首行含 sort_seq/create_time/local_type 嗅探
const wl = (o: Record<string, unknown>) => JSON.stringify({ sort_seq: '1', local_type: 1, ...o })
const zhangsanFile = [
  wl({ create_time: 1709251200, sender_username: 'wxid_a', message_content: '周末去吃火锅吧' }),
  wl({ create_time: 1709251260, sender_username: '', message_content: '好啊几点' }),
].join('\n')

function fakeRaw(files: Record<string, string>) {
  return {
    list: () => Object.keys(files).map((name) => ({ name, size: files[name].length })),
    read: (name: string) => files[name] ?? '',
  }
}
function fakeSamples(own: Record<string, string[]> = {}) {
  return {
    gatherTopSamples: () => ['我：在吗', '对方：在'],
    loadSamplesFor: (id: string) => own[id] ?? [],
  }
}

describe('chatQaRetrieval', () => {
  it('点名好友 → 读原文重解析成可读行，署名正确、不塞全局样本', () => {
    const r = makeChatQaRetrieval({
      rawStore: fakeRaw({ 'wxid_a_00000001.jsonl': zhangsanFile }),
      samples: fakeSamples(),
    })
    const { context, wantedRaw, gotNamedMaterial } = r.retrieve('我和张三上次聊啥了', [zhangsan, lisi], report)
    expect(wantedRaw).toBe(true)
    expect(gotNamedMaterial).toBe(true)
    expect(context.rawExcerpts).toHaveLength(1)
    expect(context.rawExcerpts[0].friend).toBe('张三')
    const joined = context.rawExcerpts[0].lines.join('\n')
    expect(joined).toContain('火锅')
    expect(joined).toContain('张三：')
    expect(joined).toContain('我：')
    expect(context.samples).toHaveLength(0)
    expect(context.statsSummary).toContain('2024')
  })

  it('泛问（未点名）→ 走全局样本 + 统计，rawExcerpts 为空', () => {
    const r = makeChatQaRetrieval({
      rawStore: fakeRaw({ 'wxid_a_00000001.jsonl': zhangsanFile }),
      samples: fakeSamples(),
    })
    const { context, wantedRaw } = r.retrieve('我今年过得怎么样', [zhangsan, lisi], report)
    expect(wantedRaw).toBe(false)
    expect(context.rawExcerpts).toHaveLength(0)
    expect(context.samples.length).toBeGreaterThan(0)
  })

  it('点名好友但无其原文 → 退回该好友专属样本（署名正确），gotNamedMaterial=true', () => {
    const r = makeChatQaRetrieval({
      rawStore: fakeRaw({}),
      samples: fakeSamples({ wxid_a: ['我：早', '张三：早呀'] }),
    })
    const { context, wantedRaw, gotNamedMaterial } = r.retrieve('张三说过啥', [zhangsan], report)
    expect(wantedRaw).toBe(true)
    expect(gotNamedMaterial).toBe(true)
    expect(context.rawExcerpts).toHaveLength(1)
    expect(context.rawExcerpts[0].friend).toBe('张三')
    expect(context.samples).toHaveLength(0)          // 点名场景不混入全局样本
  })

  it('点名好友但既无原文也无专属样本 → gotNamedMaterial=false（供上层提示降级）', () => {
    const r = makeChatQaRetrieval({ rawStore: fakeRaw({}), samples: fakeSamples() })
    const { context, wantedRaw, gotNamedMaterial } = r.retrieve('张三说过啥', [zhangsan], report)
    expect(wantedRaw).toBe(true)
    expect(gotNamedMaterial).toBe(false)
    expect(context.rawExcerpts).toHaveLength(0)
    expect(context.samples).toHaveLength(0)
  })

  it('群聊会话被剔除原文路径（避免多人发言张冠李戴）', () => {
    const group = friend({ id: '123@chatroom', name: '家族群' })
    const groupFile = wl({ create_time: 1709251200, sender_username: 'wxid_x', message_content: '大家好' })
    const r = makeChatQaRetrieval({
      rawStore: fakeRaw({ '123@chatroom_00000001.jsonl': groupFile }),
      samples: fakeSamples(),
    })
    const { context, wantedRaw, gotNamedMaterial } = r.retrieve('家族群里聊了啥', [group], report)
    expect(wantedRaw).toBe(true)                      // 群名命中，算点名
    expect(context.rawExcerpts).toHaveLength(0)       // 但群聊不走原文
    expect(gotNamedMaterial).toBe(false)
  })

  it('同一好友多个原文件 → 跨文件按时间排序、去重后再取', () => {
    const early = wl({ create_time: 1709251200, sender_username: 'wxid_a', message_content: '早消息' })
    const late = wl({ create_time: 1709251900, sender_username: 'wxid_a', message_content: '晚消息' })
    const r = makeChatQaRetrieval({
      rawStore: fakeRaw({
        'wxid_a_00000002.jsonl': late,                 // 只含晚消息
        'wxid_a_00000001.jsonl': [early, late].join('\n'), // 含早+晚（与上文件重叠晚消息，应去重）
      }),
      samples: fakeSamples(),
    })
    const { context } = r.retrieve('张三聊了啥', [zhangsan], report)
    const lines = context.rawExcerpts[0].lines
    expect(lines.filter((l) => l.includes('晚消息'))).toHaveLength(1)   // 去重
    const iEarly = lines.findIndex((l) => l.includes('早消息'))
    const iLate = lines.findIndex((l) => l.includes('晚消息'))
    expect(iEarly).toBeGreaterThanOrEqual(0)
    expect(iEarly).toBeLessThan(iLate)                // 时间排序：早在晚前
  })

  it('点名好友数超上限 → 最多处理 3 位', () => {
    const many = ['a', 'b', 'c', 'd'].map((k) => friend({ id: `wxid_${k}`, name: `好友${k}` }))
    const files: Record<string, string> = {}
    for (const f of many) {
      files[`${f.id}_00000001.jsonl`] = wl({ create_time: 1709251200, sender_username: f.id, message_content: '你好' })
    }
    const r = makeChatQaRetrieval({ rawStore: fakeRaw(files), samples: fakeSamples() })
    const { context } = r.retrieve('好友a好友b好友c好友d都说了啥', many, report)
    expect(context.rawExcerpts.length).toBeLessThanOrEqual(3)
  })
})
