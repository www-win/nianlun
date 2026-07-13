import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Friend, ReportData, StockPick } from '@nianlun/core'
import { makeStorage } from '../../adapters/storage'
import { makeSamples } from '../../adapters/samples'
import { createDataStore } from '../data'
import { createImportStore } from '../import'

function memStorage() {
  const m = new Map<string, unknown>()
  return makeStorage({ get: (k) => m.get(k), set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) })
}

const TXT = `2025-03-01 09:00:00 李四\n早\n\n2025-03-01 09:01:00 我\n早呀`

// 造一位 ≥20 条消息的好友，触发分析门槛（李四发 20 条）
const BIG_TXT = Array.from({ length: 20 }, (_, i) =>
  `2025-03-0${(i % 9) + 1} 09:${String(i).padStart(2, '0')}:00 李四\n消息${i}`,
).join('\n\n')

const mkFriend = (id: string, msgCount: number): Friend => ({
  id, name: id, alias: '', rel: '其他', role: '', firstContact: 0, lastContact: 0,
  msgCount, sentRatio: 0, peakPeriod: '', maxStreak: 0,
  monthly: new Array(12).fill(0), hourly: new Array(24).fill(0), weekHour: new Array(168).fill(0),
  keywords: [], userEdited: {},
})
const REPORT = { year: 2025, totalMessages: 0, friendCount: 0, activeDays: 0, topContacts: [], relationBreakdown: [] } as unknown as ReportData

describe('import store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('run 解析并写入 data store，status 变 done', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const useImport = createImportStore({ useData, storage: s, suggest: async () => ({}), loadSamples: () => [] })
    const imp = useImport()
    await imp.run([{ name: 'c.txt', content: TXT }], 2025)
    expect(imp.status).toBe('done')
    expect(useData().friends.length).toBe(1)
    const saved = s.loadSamples()
    expect(Object.keys(saved).length).toBe(1)
    const only = Object.values(saved)[0]
    expect(Array.isArray(only)).toBe(true)
    expect(only.length).toBeGreaterThan(0)
  })

  it('run 持久化最近一个月的洞察与样本，供好友详情页使用', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const useImport = createImportStore({ useData, storage: s, suggest: async () => ({}), loadSamples: () => [] })
    const imp = useImport()
    await imp.run([{ name: 'c.txt', content: TXT }], 2025)
    const fid = useData().friends[0].id
    expect(Object.keys(s.loadRecentInsights())).toContain(fid)
    expect(s.loadRecentSamples()[fid].length).toBeGreaterThan(0)
  })

  it('无法识别文件时 warnings 非空但不抛、status 仍 done', async () => {
    const s = memStorage()
    const useImport = createImportStore({
      useData: createDataStore(s), storage: s, suggest: async () => ({}), loadSamples: () => [],
    })
    const imp = useImport()
    await imp.run([{ name: 'x.bin', content: '###' }], 2025)
    expect(imp.status).toBe('done')
    expect(imp.warnings.length).toBeGreaterThan(0)
  })

  it('导入 contacts.json 给已有好友套用真实名字', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const useImport = createImportStore({ useData, storage: s, suggest: async () => ({}), loadSamples: () => [] })
    const imp = useImport()
    await imp.run([{ name: 'c.txt', content: TXT }], 2025)
    const fid = useData().friends[0].id
    // welive contacts.json：username → nick_name（群名）/ remark
    const contacts = `[{"username":"${fid}","nick_name":"真名群","local_type":2}]`
    await imp.run([{ name: 'contacts.json', content: contacts }], 2025)
    expect(useData().friends[0].name).toBe('真名群')
    expect(useData().report?.totalMessages).toBeGreaterThan(0) // 报告不被联系人导入清零
    expect(imp.warnings.some((w) => w.includes('已套用'))).toBe(true)
  })

  it('第二次导入空/不可识别文件不会清零已有报告，且报告与好友列表一致', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const useImport = createImportStore({ useData, storage: s, suggest: async () => ({}), loadSamples: () => [] })
    const imp = useImport()
    // 先导入有效聊天 → 报告应有消息数
    await imp.run([{ name: 'c.txt', content: TXT }], 2025)
    const friendMsgs = useData().friends[0].msgCount
    expect(useData().report?.totalMessages).toBe(friendMsgs)
    expect(useData().report?.friendCount).toBe(1)
    // 再导入一个解析不出聊天的文件 → 好友与报告数字都应保住，不被清零
    await imp.run([{ name: 'x.bin', content: '###' }], 2025)
    expect(useData().friends.length).toBe(1)
    expect(useData().report?.totalMessages).toBe(friendMsgs)
    expect(useData().report?.friendCount).toBe(1)
  })

  it('多批次导入后概览「聊得最多」以全量好友为准，与好友列表榜首一致', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const useImport = createImportStore({ useData, storage: s, suggest: async () => ({}), loadSamples: () => [] })
    const imp = useImport()
    // 第一批：大聊（多条消息）
    const big = Array.from({ length: 6 }, (_, i) => `2025-03-01 09:0${i}:00 大聊\n嗨${i}`).join('\n\n')
    await imp.run([{ name: 'big.txt', content: big }], 2025)
    // 第二批：小聊（少量消息）—— 修复前 report.topContacts 只反映这批，会误报小聊为榜首
    await imp.run([{ name: 'small.txt', content: '2025-03-02 09:00:00 小聊\n在吗' }], 2025)

    const friends = useData().friends
    const topByList = [...friends].sort((a, b) => b.msgCount - a.msgCount)[0]
    const report = useData().report!
    expect(report.topContacts[0].friendId).toBe(topByList.id)  // 概览榜首 == 好友列表榜首
    expect(report.topContacts[0].friendId).toBe('大聊')
  })

  it('beginReading 置读取阶段并清空提示', () => {
    const s = memStorage()
    const useImport = createImportStore({ useData: createDataStore(s), storage: s, suggest: async () => ({}), loadSamples: () => [] })
    const imp = useImport()
    imp.warnings = ['旧提示']; imp.error = '旧错误'
    imp.beginReading()
    expect(imp.status).toBe('parsing')
    expect(imp.phase).toBe('reading')
    expect(imp.progress).toBe(0)
    expect(imp.warnings).toEqual([])
    expect(imp.error).toBe('')
  })

  it('run 正常完成后 phase 归 idle、status done', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const useImport = createImportStore({ useData, storage: s, suggest: async () => ({}), loadSamples: () => [] })
    const imp = useImport()
    await imp.run([{ name: 'c.txt', content: TXT }], 2025)
    expect(imp.status).toBe('done')
    expect(imp.phase).toBe('idle')
  })

  it('reset 复位 phase 与 status', () => {
    const s = memStorage()
    const useImport = createImportStore({ useData: createDataStore(s), storage: s, suggest: async () => ({}), loadSamples: () => [] })
    const imp = useImport()
    imp.beginReading()
    imp.reset()
    expect(imp.phase).toBe('idle')
    expect(imp.status).toBe('idle')
  })

})

describe('analyzePendingRoles（门槛 + 后台分析）', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('只分析 msgCount>=20 且未分析的好友，写入 rel/role 并计入集合', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const suggest = vi.fn().mockResolvedValue({ rel: '同事', role: '产品经理' })
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => ['我：在吗'] })
    const imp = useImport()
    await useData().setData([mkFriend('big', 30), mkFriend('small', 5)], REPORT)
    await imp.analyzePendingRoles()
    expect(suggest).toHaveBeenCalledTimes(1)                     // 只 big（small 低于门槛）
    expect(useData().friends.find((f) => f.id === 'big')!.role).toBe('产品经理')
    expect(useData().friends.find((f) => f.id === 'big')!.rel).toBe('同事')
    expect(useData().friends.find((f) => f.id === 'small')!.role).toBe('')
    expect(s.loadAnalyzedIds()).toEqual(['big'])
    expect(imp.analyzing).toBe(null)
  })

  it('已在集合里的达标好友不再分析', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    s.saveAnalyzedIds(['big'])
    const suggest = vi.fn().mockResolvedValue({ role: 'PM' })
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => [] })
    const imp = useImport()
    await useData().setData([mkFriend('big', 30)], REPORT)
    await imp.analyzePendingRoles()
    expect(suggest).not.toHaveBeenCalled()
  })

  it('重入保护：analyzing 非 null 时直接返回、不分析', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const suggest = vi.fn().mockResolvedValue({ role: 'PM' })
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => [] })
    const imp = useImport()
    await useData().setData([mkFriend('big', 30)], REPORT)
    imp.analyzing = { done: 1, total: 5 } // 模拟已有分析在跑（Pinia setup store 属性可直接赋值）
    await imp.analyzePendingRoles()
    expect(suggest).not.toHaveBeenCalled()
  })

  it('失败在 warnings 里现形（不再静默）', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const suggest = vi.fn().mockRejectedValue(new Error('AI 服务未部署'))
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => ['我：hi'] })
    const imp = useImport()
    await useData().setData([mkFriend('big', 30)], REPORT)
    await imp.analyzePendingRoles()
    expect(imp.warnings.some((w) => w.includes('失败') && w.includes('AI 服务未部署'))).toBe(true)
    expect(s.loadAnalyzedIds()).toEqual([])       // 失败不入集合
    expect(imp.analyzing).toBe(null)
  })

  it('存储写入抛异常时不 reject、转为 warning、不翻已完成状态', async () => {
    const s = memStorage()
    s.saveAnalyzedIds = () => { throw new Error('存储写入失败') } // 模拟 wx 存储抛错
    const useData = createDataStore(s)
    const suggest = vi.fn().mockResolvedValue({ role: 'PM' })
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => ['我：hi'] })
    const imp = useImport()
    await useData().setData([mkFriend('big', 30)], REPORT)
    await expect(imp.analyzePendingRoles()).resolves.toBeUndefined() // 绝不 reject
    expect(imp.warnings.some((w) => w.includes('自动分析未完成') && w.includes('存储写入失败'))).toBe(true)
    expect(imp.analyzing).toBe(null)
  })

  it('消息数正好达到门槛(20)纳入分析，19 不纳入', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const suggest = vi.fn().mockResolvedValue({ role: 'PM' })
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => ['我：hi'] })
    const imp = useImport()
    await useData().setData([mkFriend('edge', 20), mkFriend('below', 19)], REPORT)
    await imp.analyzePendingRoles()
    expect(suggest).toHaveBeenCalledTimes(1)
    expect(s.loadAnalyzedIds()).toEqual(['edge'])
  })
})

describe('run 导入后不再自动分析（改为手动）', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('导入达标好友：status done，但不自动分析（role 空、suggest 未调用、集合空）', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const suggest = vi.fn().mockResolvedValue({ rel: '同事', role: 'PM' })
    const useImport = createImportStore({
      useData, storage: s, suggest,
      loadSamples: makeSamples(s).loadSamplesFor,
    })
    const imp = useImport()
    await imp.run([{ name: 'c.txt', content: BIG_TXT }], 2025)
    expect(imp.status).toBe('done')
    const big = useData().friends[0]
    expect(big.role).toBe('')                 // 不再自动写入
    expect(suggest).not.toHaveBeenCalled()    // run 不再触发分析
    expect(s.loadAnalyzedIds()).toEqual([])   // 集合不变
  })
})

const mkFriendWithRole = (id: string, role: string): Friend => ({
  id, name: id, alias: '', rel: '客户', role, firstContact: 0, lastContact: 0,
  msgCount: 9, sentRatio: 0, peakPeriod: '', maxStreak: 0,
  monthly: new Array(12).fill(0), hourly: new Array(24).fill(0), weekHour: new Array(168).fill(0),
  keywords: [], userEdited: {},
})

describe('analyzeStocks（重新导入当场抽取）', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('解析重新导入的原文 → 抽取 → saveStockPicks，暴露统计', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const extract = vi.fn().mockResolvedValue([
      { stock: '江化微', stockNorm: '江化微', recommenderId: '张三', recommender: '张三', ts: 1, logics: [], companyNotes: [] },
    ] as StockPick[])
    const useImport = createImportStore({ useData, storage: s, suggest: async () => ({}), loadSamples: () => [], extractStocks: extract })
    const imp = useImport()
    await useData().setData(
      [mkFriendWithRole('张三', '首席')],
      { year: 2026, totalMessages: 9, friendCount: 1, activeDays: 1, topContacts: [], relationBreakdown: [] } as unknown as ReportData,
    )
    await imp.analyzeStocks([{ name: 'a.txt', content: '2026-03-05 10:00:00 张三\n江化微看2倍\n\n' }])
    expect(extract).toHaveBeenCalled()
    expect(s.loadStockPicks()).toHaveLength(1)
    expect(imp.stocksSavedCount).toBe(1)
    expect(imp.analyzingStocks).toBeNull()
  })

  it('未选到聊天记录文件（如只选 contacts.json）→ 提示 warning、不调用 extract', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const extract = vi.fn().mockResolvedValue([])
    const useImport = createImportStore({ useData, storage: s, suggest: async () => ({}), loadSamples: () => [], extractStocks: extract })
    const imp = useImport()
    await useData().setData([mkFriendWithRole('张三', '首席')], REPORT)
    const contacts = `[{"username":"张三","nick_name":"真名","local_type":2}]`
    await imp.analyzeStocks([{ name: 'contacts.json', content: contacts }])
    expect(extract).not.toHaveBeenCalled()
    expect(imp.warnings.some((w) => w.includes('未选择聊天记录文件'))).toBe(true)
    expect(imp.analyzingStocks).toBeNull()
  })

  it('extract 异常不阻断，警告落 warnings，analyzingStocks 收尾清空', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const extract = vi.fn().mockRejectedValue(new Error('云函数超时'))
    const useImport = createImportStore({ useData, storage: s, suggest: async () => ({}), loadSamples: () => [], extractStocks: extract })
    const imp = useImport()
    await useData().setData([mkFriendWithRole('张三', '首席')], REPORT)
    await imp.analyzeStocks([{ name: 'a.txt', content: '2026-03-05 10:00:00 张三\n江化微看2倍\n\n' }])
    expect(imp.warnings.some((w) => w.includes('云函数超时'))).toBe(true)
    expect(imp.analyzingStocks).toBeNull()
  })

  it('重入保护：analyzingStocks 非 null 时直接返回、不再次分析', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const extract = vi.fn().mockResolvedValue([])
    const useImport = createImportStore({ useData, storage: s, suggest: async () => ({}), loadSamples: () => [], extractStocks: extract })
    const imp = useImport()
    await useData().setData([mkFriendWithRole('张三', '首席')], REPORT)
    imp.analyzingStocks = { done: 0, total: 1 }
    await imp.analyzeStocks([{ name: 'a.txt', content: '2026-03-05 10:00:00 张三\n江化微看2倍\n\n' }])
    expect(extract).not.toHaveBeenCalled()
  })

  it('第二次窄范围重选不冲掉历史荐股：与已存合并去重（Critical 回归）', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    // 按好友 id 返回各自固定的荐股，便于断言是否被保留/去重
    const extract = vi.fn(async (f: Friend) => ([
      {
        stock: f.id === '张三' ? '股票A' : '股票B',
        stockNorm: f.id === '张三' ? '股票A' : '股票B',
        recommenderId: f.id, recommender: f.id, ts: 1, logics: [], companyNotes: [],
      },
    ] as StockPick[]))
    const useImport = createImportStore({ useData, storage: s, suggest: async () => ({}), loadSamples: () => [], extractStocks: extract })
    const imp = useImport()
    await useData().setData(
      [mkFriendWithRole('张三', '首席'), mkFriendWithRole('李四', '基金经理')],
      { year: 2026, totalMessages: 18, friendCount: 2, activeDays: 1, topContacts: [], relationBreakdown: [] } as unknown as ReportData,
    )
    // 第一次：两位好友的会话都在重选文件里（txt 解析器每个文件只认第一个「对方」发送者，故分两个文件）
    await imp.analyzeStocks([
      { name: 'zhangsan.txt', content: '2026-03-05 10:00:00 张三\n股票A看2倍\n\n' },
      { name: 'lisi.txt', content: '2026-03-05 10:00:00 李四\n股票B不错\n\n' },
    ])
    expect(s.loadStockPicks()).toHaveLength(2)
    expect(imp.stocksSavedCount).toBe(2)

    // 第二次：较窄的重选文件，只含李四的会话（张三本次未匹配到会话）
    await imp.analyzeStocks([{ name: 'lisi-again.txt', content: '2026-03-05 10:00:00 李四\n股票B不错\n\n' }])
    // 张三的历史荐股不应被冲掉；李四重复抽取的同一条记录被去重、不重复计入
    expect(s.loadStockPicks().map((p) => p.recommenderId).sort()).toEqual(['张三', '李四'])
    expect(s.loadStockPicks()).toHaveLength(2)
    expect(imp.stocksSavedCount).toBe(2)
  })

  it('重选文件里的无法识别行会作为 warning 现形，而不是被静默丢弃', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const extract = vi.fn().mockResolvedValue([])
    const useImport = createImportStore({ useData, storage: s, suggest: async () => ({}), loadSamples: () => [], extractStocks: extract })
    const imp = useImport()
    await useData().setData([mkFriendWithRole('张三', '首席')], REPORT)
    // 首行是裸文本（无时间戳头），txt 解析器会记一条「无法识别的行」warning
    await imp.analyzeStocks([{ name: 'messy.txt', content: '一段无法识别的杂乱文本\n\n2026-03-05 10:00:00 张三\n股票A看2倍\n\n' }])
    expect(imp.warnings.some((w) => w.includes('messy.txt') && w.includes('无法识别的行'))).toBe(true)
  })
})

describe('analyzeOne（手动单个分析）', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('成功：写入 rel/role、计入 analyzedIds、返回 ok（不受门槛限制）', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const suggest = vi.fn().mockResolvedValue({ rel: '同事', role: '产品经理' })
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => ['我：hi'] })
    const imp = useImport()
    await useData().setData([mkFriend('a', 5)], REPORT)     // 5 条 < 20，验证手动不套门槛
    const r = await imp.analyzeOne('a')
    expect(r.status).toBe('ok')
    expect(suggest).toHaveBeenCalledTimes(1)
    expect(useData().friends[0].role).toBe('产品经理')
    expect(useData().friends[0].rel).toBe('同事')
    expect(s.loadAnalyzedIds()).toContain('a')
    expect(imp.analyzingIds.has('a')).toBe(false)           // 收尾清空
  })

  it('AI 无结果：返回 empty，不写入、不计集合', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const suggest = vi.fn().mockResolvedValue({})
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => [] })
    const imp = useImport()
    await useData().setData([mkFriend('a', 30)], REPORT)
    const r = await imp.analyzeOne('a')
    expect(r.status).toBe('empty')
    expect(useData().friends[0].role).toBe('')
    expect(s.loadAnalyzedIds()).toEqual([])
  })

  it('suggest 抛异常：返回 error 带 message、不 reject、状态复位', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const suggest = vi.fn().mockRejectedValue(new Error('云函数超时'))
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => [] })
    const imp = useImport()
    await useData().setData([mkFriend('a', 30)], REPORT)
    const r = await imp.analyzeOne('a')
    expect(r.status).toBe('error')
    expect(r.error).toContain('云函数超时')
    expect(imp.analyzingIds.has('a')).toBe(false)
  })

  it('重入保护：该好友分析中再次调用返回 skipped、不重复触发 suggest', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    let release!: (v: unknown) => void
    const suggest = vi.fn(() => new Promise((res) => { release = res }))
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => [] })
    const imp = useImport()
    await useData().setData([mkFriend('a', 30)], REPORT)
    const p1 = imp.analyzeOne('a')            // 挂起中（suggest 未 resolve）
    const r2 = await imp.analyzeOne('a')      // 同一好友：立即 skipped
    expect(r2.status).toBe('skipped')
    expect(suggest).toHaveBeenCalledTimes(1)
    release({ role: 'PM' })
    await p1
  })

  it('好友不存在：返回 skipped、不触发 suggest', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const suggest = vi.fn()
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => [] })
    const imp = useImport()
    await useData().setData([mkFriend('a', 30)], REPORT)
    const r = await imp.analyzeOne('missing')
    expect(r.status).toBe('skipped')
    expect(suggest).not.toHaveBeenCalled()
  })
})
