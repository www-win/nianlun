import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Friend, ReportData, StockPick } from '@nianlun/core'
import { makeStorage } from '../../adapters/storage'
import { createDataStore } from '../data'
import { createImportStore } from '../import'

function memStorage() {
  const m = new Map<string, unknown>()
  return makeStorage({ get: (k) => m.get(k), set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) })
}

const TXT = `2025-03-01 09:00:00 李四\n早\n\n2025-03-01 09:01:00 我\n早呀`

const REPORT = { year: 2025, totalMessages: 0, friendCount: 0, activeDays: 0, topContacts: [], relationBreakdown: [] } as unknown as ReportData

describe('import store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('run 解析并写入 data store，status 变 done', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const useImport = createImportStore({ useData, storage: s })
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
    const useImport = createImportStore({ useData, storage: s })
    const imp = useImport()
    await imp.run([{ name: 'c.txt', content: TXT }], 2025)
    const fid = useData().friends[0].id
    expect(Object.keys(s.loadRecentInsights())).toContain(fid)
    expect(s.loadRecentSamples()[fid].length).toBeGreaterThan(0)
  })

  it('无法识别文件时 warnings 非空但不抛、status 仍 done', async () => {
    const s = memStorage()
    const useImport = createImportStore({ useData: createDataStore(s), storage: s })
    const imp = useImport()
    await imp.run([{ name: 'x.bin', content: '###' }], 2025)
    expect(imp.status).toBe('done')
    expect(imp.warnings.length).toBeGreaterThan(0)
  })

  it('导入 contacts.json 给已有好友套用真实名字', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const useImport = createImportStore({ useData, storage: s })
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
    const useImport = createImportStore({ useData, storage: s })
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
    const useImport = createImportStore({ useData, storage: s })
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
    const useImport = createImportStore({ useData: createDataStore(s), storage: s })
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
    const useImport = createImportStore({ useData, storage: s })
    const imp = useImport()
    await imp.run([{ name: 'c.txt', content: TXT }], 2025)
    expect(imp.status).toBe('done')
    expect(imp.phase).toBe('idle')
  })

  it('reset 复位 phase 与 status', () => {
    const s = memStorage()
    const useImport = createImportStore({ useData: createDataStore(s), storage: s })
    const imp = useImport()
    imp.beginReading()
    imp.reset()
    expect(imp.phase).toBe('idle')
    expect(imp.status).toBe('idle')
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
    const useImport = createImportStore({ useData, storage: s, extractStocks: extract })
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
    const useImport = createImportStore({ useData, storage: s, extractStocks: extract })
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
    const useImport = createImportStore({ useData, storage: s, extractStocks: extract })
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
    const useImport = createImportStore({ useData, storage: s, extractStocks: extract })
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
    const useImport = createImportStore({ useData, storage: s, extractStocks: extract })
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
    const useImport = createImportStore({ useData, storage: s, extractStocks: extract })
    const imp = useImport()
    await useData().setData([mkFriendWithRole('张三', '首席')], REPORT)
    // 首行是裸文本（无时间戳头），txt 解析器会记一条「无法识别的行」warning
    await imp.analyzeStocks([{ name: 'messy.txt', content: '一段无法识别的杂乱文本\n\n2026-03-05 10:00:00 张三\n股票A看2倍\n\n' }])
    expect(imp.warnings.some((w) => w.includes('messy.txt') && w.includes('无法识别的行'))).toBe(true)
  })
})
