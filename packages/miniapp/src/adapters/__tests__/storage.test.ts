import { describe, it, expect, vi } from 'vitest'
import { makeStorage } from '../storage'
import { makeFsJson, makeKvFsJson } from '../fsStore'
import type { RawFsBackend } from '../rawStore'
import type { Friend, ReportData, BirthInfo, StockPick, MbtiResult, RelationDeep } from '@nianlun/core'

function memBackend() {
  const m = new Map<string, unknown>()
  return { get: (k: string) => m.get(k), set: (k: string, v: unknown) => void m.set(k, v), remove: (k: string) => void m.delete(k) }
}

const FRIEND = { id: 'f1', name: '张三' } as unknown as Friend
const REPORT = { year: 2025 } as unknown as ReportData

describe('storage 适配器', () => {
  it('saveFriends/loadFriends 往返', () => {
    const s = makeStorage(memBackend())
    s.saveFriends([FRIEND])
    expect(s.loadFriends()[0].id).toBe('f1')
  })

  it('loadFriends 给缺失字段补默认值', () => {
    const s = makeStorage(memBackend())
    s.saveFriends([FRIEND])                 // 没有 hourly/weekHour/keywords
    const f = s.loadFriends()[0]
    expect(f.hourly).toHaveLength(24)
    expect(f.weekHour).toHaveLength(168)
    expect(f.keywords).toEqual([])
  })

  it('loadReport 无数据时返回 null', () => {
    const s = makeStorage(memBackend())
    expect(s.loadReport()).toBeNull()
  })

  it('clearAll 清空全部键', () => {
    const s = makeStorage(memBackend())
    s.saveFriends([FRIEND]); s.saveReport(REPORT)
    s.saveRecentInsights({ f1: { keywords: [], weekHour: [] } })
    s.saveRecentSamples({ f1: ['我：在'] })
    s.clearAll()
    expect(s.loadFriends()).toEqual([])
    expect(s.loadReport()).toBeNull()
    expect(s.loadRecentInsights()).toEqual({})
    expect(s.loadRecentSamples()).toEqual({})
  })

  it('saveRecentInsights/loadRecentInsights 往返，缺失返回空对象', () => {
    const s = makeStorage(memBackend())
    expect(s.loadRecentInsights()).toEqual({})
    s.saveRecentInsights({ f1: { keywords: [{ word: '你好', count: 3 }], weekHour: [1, 2] } })
    expect(s.loadRecentInsights().f1.keywords[0].word).toBe('你好')
  })

  it('saveRecentSamples/loadRecentSamples 往返，缺失返回空对象', () => {
    const s = makeStorage(memBackend())
    expect(s.loadRecentSamples()).toEqual({})
    s.saveRecentSamples({ f1: ['我：在吗'] })
    expect(s.loadRecentSamples().f1).toEqual(['我：在吗'])
  })

  // wx.getStorageSync 对不存在的键返回空字符串 '' 而非 undefined，?? 兜底挡不住，
  // 会导致 ''.map 崩溃。这里模拟该真机行为，确保按类型兜底。
  it('后端对缺失键返回空字符串时安全兜底（模拟 wx.getStorageSync）', () => {
    const wxLike = { get: (_k: string) => '', set: () => {}, remove: () => {} }
    const s = makeStorage(wxLike)
    expect(s.loadFriends()).toEqual([])
    expect(s.loadReport()).toBeNull()
    expect(s.loadSamples()).toEqual({})
    expect(s.loadRecentInsights()).toEqual({})
    expect(s.loadRecentSamples()).toEqual({})
  })

  it('analyzedIds 存取；缺键返回 []，clearAll 清除', () => {
    const m = new Map<string, unknown>()
    const s = makeStorage({ get: (k) => m.get(k), set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) })
    expect(s.loadAnalyzedIds()).toEqual([])
    s.saveAnalyzedIds(['a', 'b'])
    expect(s.loadAnalyzedIds()).toEqual(['a', 'b'])
    s.clearAll()
    expect(s.loadAnalyzedIds()).toEqual([])
  })

  it('purgeLegacyRaw 用 keys 精确清 raw 残留键、保留其它数据', () => {
    const m = new Map<string, unknown>([
      ['nianlun:rawIndex', { count: 2 }],
      ['nianlun:raw:0', 'x'], ['nianlun:raw:1', 'y'],
      ['nianlun:friends', [FRIEND]],
    ])
    const s = makeStorage({
      get: (k) => m.get(k), set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k),
      keys: () => [...m.keys()],
    })
    s.purgeLegacyRaw()
    expect(m.has('nianlun:rawIndex')).toBe(false)
    expect(m.has('nianlun:raw:0')).toBe(false)
    expect(m.has('nianlun:raw:1')).toBe(false)
    expect(m.has('nianlun:friends')).toBe(true) // 聚合数据保留
  })

  it('purgeLegacyRaw 在 backend 无 keys 时按 rawIndex.count 兜底删块', () => {
    const m = new Map<string, unknown>([
      ['nianlun:rawIndex', { count: 3 }],
      ['nianlun:raw:0', 'a'], ['nianlun:raw:1', 'b'], ['nianlun:raw:2', 'c'],
      ['nianlun:friends', [FRIEND]],
    ])
    const s = makeStorage({ get: (k) => m.get(k), set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) })
    s.purgeLegacyRaw()
    expect(m.has('nianlun:raw:0')).toBe(false)
    expect(m.has('nianlun:raw:2')).toBe(false)
    expect(m.has('nianlun:rawIndex')).toBe(false)
    expect(m.has('nianlun:friends')).toBe(true)
  })
})

describe('命理存储', () => {
  const BIRTH: BirthInfo = { year: 1990, month: 8, day: 15, hour: 14 }

  it('saveMyBazi/loadMyBazi 往返，缺失返回 null', () => {
    const s = makeStorage(memBackend())
    expect(s.loadMyBazi()).toBeNull()
    s.saveMyBazi(BIRTH)
    expect(s.loadMyBazi()).toEqual(BIRTH)
  })

  it('saveBirths/loadBirths 往返，缺失返回空对象', () => {
    const s = makeStorage(memBackend())
    expect(s.loadBirths()).toEqual({})
    s.saveBirths({ f1: BIRTH })
    expect(s.loadBirths().f1).toEqual(BIRTH)
  })

  it('saveAstroReading/loadAstroReading 往返，缺失返回空对象', () => {
    const s = makeStorage(memBackend())
    expect(s.loadAstroReading()).toEqual({})
    s.saveAstroReading({
      f1: {
        reading: { personality: '稳' },
        chart: { pillars: { year: '庚午', month: '甲申', day: '丙子' }, dayMaster: '丙', fiveElements: {}, zodiac: '马', constellation: '狮子' },
        generatedDate: '2026-07-06', birthFingerprint: 'x', myBaziFingerprint: 'y',
      },
    })
    expect(s.loadAstroReading().f1.generatedDate).toBe('2026-07-06')
    expect(s.loadAstroReading().f1.reading.personality).toBe('稳')
  })

  it('缺键返回空字符串时安全兜底（模拟真机）', () => {
    const wxLike = { get: (_k: string) => '', set: () => {}, remove: () => {} }
    const s = makeStorage(wxLike)
    expect(s.loadMyBazi()).toBeNull()
    expect(s.loadBirths()).toEqual({})
    expect(s.loadAstroReading()).toEqual({})
  })

  it('clearAll 清除命理三键', () => {
    const s = makeStorage(memBackend())
    s.saveMyBazi(BIRTH); s.saveBirths({ f1: BIRTH })
    s.saveAstroReading({ f1: { reading: {}, chart: {} as any, generatedDate: 'd', birthFingerprint: 'x', myBaziFingerprint: 'y' } })
    s.clearAll()
    expect(s.loadMyBazi()).toBeNull()
    expect(s.loadBirths()).toEqual({})
    expect(s.loadAstroReading()).toEqual({})
  })
})

describe('四类 AI 结果持久化', () => {
  const FRIEND_FP = { id: 'f1', name: '张三', msgCount: 100, lastContact: 1700000000000 } as unknown as Friend
  const REPORT_FP = { year: 2025, totalMessages: 5000, friendCount: 50, activeDays: 200 } as unknown as ReportData

  it('好友情绪：save/load 往返一致且新鲜', () => {
    const s = makeStorage(memBackend())
    s.saveFriendSentiment('f1', FRIEND_FP, { tone: '热络', summary: '常聊' })
    expect(s.loadFriendSentiment('f1', FRIEND_FP)).toEqual({ data: { tone: '热络', summary: '常聊' }, stale: false })
  })

  it('好友情绪：msgCount 变化 → 旧缓存 + stale=true，且未清空', () => {
    const s = makeStorage(memBackend())
    s.saveFriendSentiment('f1', FRIEND_FP, { tone: '热络' })
    const changed = { ...FRIEND_FP, msgCount: 200 } as Friend
    expect(s.loadFriendSentiment('f1', changed)).toEqual({ data: { tone: '热络' }, stale: true })
    expect(s.loadFriendSentiment('f1', FRIEND_FP)!.stale).toBe(false) // 未被清空
  })

  it('好友情绪：lastContact 变化也判过期', () => {
    const s = makeStorage(memBackend())
    s.saveFriendSentiment('f1', FRIEND_FP, { tone: '热络' })
    const changed = { ...FRIEND_FP, lastContact: 1800000000000 } as Friend
    expect(s.loadFriendSentiment('f1', changed)!.stale).toBe(true)
  })

  it('好友情绪：无缓存返回 null', () => {
    expect(makeStorage(memBackend()).loadFriendSentiment('f1', FRIEND_FP)).toBeNull()
  })

  it('好友级 map 隔离：写 A 不影响 B', () => {
    const s = makeStorage(memBackend())
    const A = { ...FRIEND_FP, id: 'A' } as Friend
    const B = { ...FRIEND_FP, id: 'B' } as Friend
    s.saveFriendSentiment('A', A, { tone: 'A调' })
    expect(s.loadFriendSentiment('B', B)).toBeNull()
    expect(s.loadFriendSentiment('A', A)!.data.tone).toBe('A调')
  })

  it('好友画像：save/load 往返 + msgCount 变化判过期', () => {
    const s = makeStorage(memBackend())
    s.saveFriendProfile('f1', FRIEND_FP, { identity: '医生' })
    expect(s.loadFriendProfile('f1', FRIEND_FP)).toEqual({ data: { identity: '医生' }, stale: false })
    const changed = { ...FRIEND_FP, msgCount: 300 } as Friend
    expect(s.loadFriendProfile('f1', changed)!.stale).toBe(true)
  })

  it('报告文案：save/load 往返新鲜；totalMessages 变化 → stale 且保留旧值', () => {
    const s = makeStorage(memBackend())
    s.saveReportCopy(REPORT_FP, '这一年很温暖')
    expect(s.loadReportCopy(REPORT_FP)).toEqual({ data: '这一年很温暖', stale: false })
    const changed = { ...REPORT_FP, totalMessages: 6000 } as ReportData
    expect(s.loadReportCopy(changed)).toEqual({ data: '这一年很温暖', stale: true })
  })

  it('全年情绪：save/load 往返 + friendCount 变化判过期', () => {
    const s = makeStorage(memBackend())
    s.saveYearMood(REPORT_FP, '整体热络')
    expect(s.loadYearMood(REPORT_FP)).toEqual({ data: '整体热络', stale: false })
    const changed = { ...REPORT_FP, friendCount: 60 } as ReportData
    expect(s.loadYearMood(changed)!.stale).toBe(true)
  })

  it('无缓存/缺键空串兜底一律返回 null，不抛', () => {
    const s = makeStorage(memBackend())
    expect(s.loadReportCopy(REPORT_FP)).toBeNull()
    expect(s.loadYearMood(REPORT_FP)).toBeNull()
    const wxLike = { get: (_k: string) => '', set: () => {}, remove: () => {} }
    const s2 = makeStorage(wxLike)
    expect(s2.loadFriendSentiment('f1', FRIEND_FP)).toBeNull()
    expect(s2.loadFriendProfile('f1', FRIEND_FP)).toBeNull()
    expect(s2.loadReportCopy(REPORT_FP)).toBeNull()
    expect(s2.loadYearMood(REPORT_FP)).toBeNull()
  })

  it('clearAll 清除四类 AI 结果', () => {
    const s = makeStorage(memBackend())
    s.saveFriendSentiment('f1', FRIEND_FP, { tone: 'x' })
    s.saveFriendProfile('f1', FRIEND_FP, { identity: 'y' })
    s.saveReportCopy(REPORT_FP, 'c'); s.saveYearMood(REPORT_FP, 'm')
    s.clearAll()
    expect(s.loadFriendSentiment('f1', FRIEND_FP)).toBeNull()
    expect(s.loadFriendProfile('f1', FRIEND_FP)).toBeNull()
    expect(s.loadReportCopy(REPORT_FP)).toBeNull()
    expect(s.loadYearMood(REPORT_FP)).toBeNull()
  })

  it('saveFriendMbti/loadFriendMbti 往返，指纹随 msgCount 失效，clearAll 清空', () => {
    const s = makeStorage(memBackend())
    const data: MbtiResult = {
      code: 'INTJ', title: '建筑师', summary: 's',
      dimensions: [
        { axis: 'EI', pole: 'I', strength: 70 },
        { axis: 'SN', pole: 'N', strength: 60 },
        { axis: 'TF', pole: 'T', strength: 80 },
        { axis: 'JP', pole: 'J', strength: 55 },
      ],
    }
    s.saveFriendMbti('f1', FRIEND_FP, data)

    const fresh = s.loadFriendMbti('f1', FRIEND_FP)
    expect(fresh).not.toBeNull()
    expect(fresh!.data.code).toBe('INTJ')
    expect(fresh!.stale).toBe(false)

    const changed = { ...FRIEND_FP, msgCount: 200 } as Friend
    expect(s.loadFriendMbti('f1', changed)!.stale).toBe(true)

    s.clearAll()
    expect(s.loadFriendMbti('f1', FRIEND_FP)).toBeNull()
  })

  it('loadFriendMbtiMap 一次性读整表：N 个好友只触发 1 次 backend.get', () => {
    // 计数后端：统计对 MBTI 键的 get 次数，验证批量读避免 O(N) 次同步 getStorageSync
    const m = new Map<string, unknown>()
    let getCount = 0
    const counting = {
      get: (k: string) => { getCount++; return m.get(k) },
      set: (k: string, v: unknown) => void m.set(k, v),
      remove: (k: string) => void m.delete(k),
    }
    const s = makeStorage(counting)
    const mk = (code: string): MbtiResult => ({ code, title: 't', summary: 's', dimensions: [] } as unknown as MbtiResult)
    for (let i = 0; i < 50; i++) {
      s.saveFriendMbti(`f${i}`, { id: `f${i}`, msgCount: 1, lastContact: 1 } as unknown as Friend, mk('INTJ'))
    }
    getCount = 0
    const map = s.loadFriendMbtiMap()
    expect(getCount).toBe(1)                    // 整表只读 1 次，而非 50 次
    expect(map.f0?.code).toBe('INTJ')
    expect(map.f49?.code).toBe('INTJ')
    expect(map.fx).toBeUndefined()
  })
})

describe('storage relationDeep', () => {
  it('save/load 往返，指纹一致时 stale=false', () => {
    const backend = memBackend()
    const s = makeStorage(backend)
    const friend = { id: 'f1', msgCount: 100, lastContact: 5 } as unknown as Friend
    const data: RelationDeep = { overall: '很好', suggestions: [{ topic: '沟通', advice: '多聊' }] }
    s.saveRelationDeep('f1', friend, data)
    const got = s.loadRelationDeep('f1', friend)
    expect(got?.data.overall).toBe('很好')
    expect(got?.stale).toBe(false)
  })

  it('好友统计变化（msgCount 变）→ stale=true', () => {
    const backend = memBackend()
    const s = makeStorage(backend)
    const f1 = { id: 'f1', msgCount: 100, lastContact: 5 } as unknown as Friend
    s.saveRelationDeep('f1', f1, { overall: 'x' })
    const f2 = { id: 'f1', msgCount: 200, lastContact: 9 } as unknown as Friend
    expect(s.loadRelationDeep('f1', f2)?.stale).toBe(true)
  })

  it('未存过返回 null', () => {
    const s = makeStorage(memBackend())
    expect(s.loadRelationDeep('nope', { id: 'nope', msgCount: 1, lastContact: 1 } as unknown as Friend)).toBeNull()
  })

  it('clearAll 清除深度关系分析缓存', () => {
    const s = makeStorage(memBackend())
    const friend = { id: 'f1', msgCount: 100, lastContact: 5 } as unknown as Friend
    s.saveRelationDeep('f1', friend, { overall: 'x' })
    s.clearAll()
    expect(s.loadRelationDeep('f1', friend)).toBeNull()
  })
})

const PICK = (over: Partial<StockPick> = {}): StockPick => ({
  stock: '江化微', stockNorm: '江化微', recommenderId: '张三', recommender: '张三首席',
  ts: 100, logics: [], companyNotes: [], ...over,
})

describe('storage 荐股', () => {
  it('saveStockPicks / loadStockPicks 往返', () => {
    const s = makeStorage(memBackend())
    s.saveStockPicks([PICK(), PICK({ stock: 'B', stockNorm: 'B' })])
    expect(s.loadStockPicks().map((p) => p.stock)).toEqual(['江化微', 'B'])
  })
  it('无数据 → []', () => {
    expect(makeStorage(memBackend()).loadStockPicks()).toEqual([])
  })
  it('clearAll 后荐股为 []', () => {
    const s = makeStorage(memBackend())
    s.saveStockPicks([PICK()])
    s.clearAll()
    expect(s.loadStockPicks()).toEqual([])
  })
})

function memFsBackend(): RawFsBackend {
  const files = new Map<string, string>()
  return {
    ensureDir: () => {}, writeFile: (p, d) => { files.set(p, d) },
    readFile: (p) => { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p)! },
    readdir: () => [...files.keys()], size: (p) => (files.get(p)?.length ?? 0),
    unlink: (p) => { files.delete(p) },
  }
}

describe('storage 整表批量读（防卡）', () => {
  it('loadFriendSentimentMap/ProfileMap/RelationDeepMap 整表一次读，返回 {id:data}', () => {
    const s = makeStorage(memBackend())
    const f = (id: string): Friend => ({ id, msgCount: 30, lastContact: 1 } as unknown as Friend)
    s.saveFriendSentiment('a', f('a'), { tone: '暖', summary: 's' } as any)
    s.saveFriendProfile('b', f('b'), { identity: 'x' } as any)
    s.saveRelationDeep('c', f('c'), { overall: 'o' } as any)
    expect(s.loadFriendSentimentMap()['a']).toEqual({ tone: '暖', summary: 's' })
    expect(s.loadFriendProfileMap()['b']).toEqual({ identity: 'x' })
    expect(s.loadRelationDeepMap()['c']).toEqual({ overall: 'o' })
  })
})

describe('好友级 AI 结果 debounce 合并写（防卡）', () => {
  it('saveFriendSentiment 缓冲：debounce 窗口内多次写只触发一次 backend.set；flushNow 立即写', () => {
    const mem = memBackend()
    const setSpy = vi.spyOn(mem, 'set')
    const s = makeStorage(mem)
    const f = (id: string): Friend => ({ id, msgCount: 30, lastContact: 1 } as unknown as Friend)
    const before = setSpy.mock.calls.filter((c) => c[0] === 'nianlun:friendSentiment').length
    s.saveFriendSentiment('a', f('a'), { tone: '暖' } as any)
    s.saveFriendSentiment('b', f('b'), { tone: '冷' } as any)
    // flush 前：read-through 能读到；backend 尚未写入这张表
    expect(s.loadFriendSentiment('a', f('a'))?.data).toEqual({ tone: '暖' })
    expect(setSpy.mock.calls.filter((c) => c[0] === 'nianlun:friendSentiment').length).toBe(before)
    s.flushNow()
    const merged = mem.get('nianlun:friendSentiment') as Record<string, { data: unknown }>
    expect(merged.a.data).toEqual({ tone: '暖' })
    expect(merged.b.data).toEqual({ tone: '冷' })
  })
})

describe('storage 大数据走文件后端', () => {
  it('saveFriends 写文件后端、不写 KV；loadFriends 从文件读回并补默认字段', () => {
    const kvMap = new Map<string, unknown>()
    const kv = { get: (k: string) => kvMap.get(k), set: (k: string, v: unknown) => void kvMap.set(k, v), remove: (k: string) => void kvMap.delete(k) }
    const fs = makeFsJson(memFsBackend(), '/store')
    const s = makeStorage(kv, fs)
    s.saveFriends([{ id: 'f1', name: '张三' } as unknown as Friend])
    // 大数据不落 KV
    expect(kvMap.has('nianlun:friends')).toBe(false)
    const f = s.loadFriends()[0]
    expect(f.id).toBe('f1')
    expect(f.weekHour).toHaveLength(168)   // 补默认字段逻辑保留
  })
  it('saveStockPicks/loadStockPicks 走文件后端往返；clearAll 清文件', () => {
    const kv = { get: () => undefined, set: () => {}, remove: () => {} }
    const fs = makeFsJson(memFsBackend(), '/store')
    const s = makeStorage(kv, fs)
    s.saveStockPicks([{ stock: '江化微', stockNorm: '江化微', recommenderId: 'x', recommender: 'x', ts: 1, logics: [], companyNotes: [] } as never])
    expect(s.loadStockPicks()).toHaveLength(1)
    s.clearAll()
    expect(s.loadStockPicks()).toEqual([])
    expect(s.loadFriends()).toEqual([])
  })
})

describe('purgeLegacyBigKeys', () => {
  it('删除旧大 KV 键、保留其它键', () => {
    const m = new Map<string, unknown>([
      ['nianlun:friends', [1]], ['nianlun:samples', {}], ['nianlun:recentInsights', {}],
      ['nianlun:recentSamples', {}], ['nianlun:stocks', [1]],
      ['nianlun:report', { year: 2026 }], ['nianlun:analyzedIds', ['a']],
    ])
    const kv = { get: (k: string) => m.get(k), set: (k: string, v: unknown) => void m.set(k, v), remove: (k: string) => void m.delete(k) }
    makeStorage(kv).purgeLegacyBigKeys()
    expect(m.has('nianlun:friends')).toBe(false)
    expect(m.has('nianlun:samples')).toBe(false)
    expect(m.has('nianlun:stocks')).toBe(false)
    expect(m.has('nianlun:report')).toBe(true)      // 小元数据保留
    expect(m.has('nianlun:analyzedIds')).toBe(true)
  })
})

describe('storage exportAll/importAll', () => {
  function memBackendWithKeys() {
    const m = new Map<string, unknown>()
    return {
      get: (k: string) => (m.has(k) ? m.get(k) : ''),
      set: (k: string, v: unknown) => void m.set(k, v),
      remove: (k: string) => void m.delete(k),
      keys: () => [...m.keys()],
      _m: m,
    }
  }

  it('往返：export 后 import 到新 storage，数据等价', () => {
    const b1 = memBackendWithKeys()
    const s1 = makeStorage(b1, makeKvFsJson(b1))
    s1.saveReport({ year: 2025, totalMessages: 3, friendCount: 1, activeDays: 2, topContacts: [], latestMessage: null, keywords: [], relationBreakdown: [] } as any)
    s1.saveFriends([{ id: 'a', name: '甲', msgCount: 5 } as any])
    s1.saveStockPicks([{ code: '600000' } as any])

    const snap = s1.exportAll()

    const b2 = memBackendWithKeys()
    const s2 = makeStorage(b2, makeKvFsJson(b2))
    s2.importAll(snap)
    expect(s2.loadReport()?.year).toBe(2025)
    expect(s2.loadFriends()[0].id).toBe('a')
    expect(s2.loadStockPicks()[0].code).toBe('600000')
  })

  it('exportAll 忽略 legacy 键与非 nianlun 键', () => {
    const b = memBackendWithKeys()
    const s = makeStorage(b, makeKvFsJson(b))
    s.saveReport({ year: 2025 } as any)
    b.set('nianlun:raw:0', 'x')          // legacy
    b.set('nianlun:rawIndex', { count: 1 }) // legacy
    b.set('other:thing', 'y')             // 非 nianlun
    const snap = s.exportAll()
    expect(Object.keys(snap.kv)).toContain('nianlun:report')
    expect(Object.keys(snap.kv)).not.toContain('nianlun:raw:0')
    expect(Object.keys(snap.kv)).not.toContain('nianlun:rawIndex')
    expect(Object.keys(snap.kv)).not.toContain('other:thing')
  })

  it('importAll 只增不删（不清除未覆盖的已有键）', () => {
    const b = memBackendWithKeys()
    const s = makeStorage(b, makeKvFsJson(b))
    s.saveMyBazi({ y: 1 } as any)
    s.importAll({ kv: { 'nianlun:report': { year: 2025 } }, files: {} })
    expect(s.loadReport()?.year).toBe(2025)
    expect(s.loadMyBazi()).toEqual({ y: 1 }) // 未被清掉
  })
})

describe('AI 结果落盘触发 onChanged（供自动云备份）', () => {
  it('各类 AI 保存各触发一次；非 AI 保存不触发', () => {
    const s = makeStorage(memBackend())
    let calls = 0
    s.setOnChanged(() => { calls++ })

    s.saveFriendSentiment('f1', FRIEND, { tone: '热络' })              // saveFriendEntry（缓冲，不立即触发）
    s.saveFriendProfile('f1', FRIEND, { identity: '产品' })            // saveFriendEntry（缓冲，不立即触发）
    s.saveFriendMbti('f1', FRIEND, { code: 'INTJ' } as unknown as MbtiResult) // saveFriendEntry（缓冲，不立即触发）
    s.saveRelationDeep('f1', FRIEND, { overall: 'x' } as RelationDeep) // saveFriendEntry（缓冲，不立即触发）
    expect(calls).toBe(0)   // 四个好友级缓冲写合并等待 flush，尚未触发
    s.flushNow()                                                        // 合并落盘，一次触发
    s.saveReportCopy(REPORT, '文案')                                    // saveReportEntry
    s.saveYearMood(REPORT, '情绪')                                      // saveReportEntry
    s.saveAstroReading({})                                              // 单独
    s.saveStockPicks([])                                                // 单独
    expect(calls).toBe(5)   // 好友级 4 类合并为 1 次 + 报告文案/全年情绪/命理/荐股各 1 次

    const before = calls
    s.saveFriends([FRIEND])   // 非 AI（其备份由 data store 的 onSaved 负责），不触发
    s.saveReport(REPORT)
    s.saveMyBazi({ y: 1 } as unknown as BirthInfo)  // 用户生辰输入，非 AI 结果
    expect(calls).toBe(before)
  })
})
