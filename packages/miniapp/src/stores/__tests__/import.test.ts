import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Friend, ReportData } from '@nianlun/core'
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

  it('run 留存原始聊天文本，供将来二级分析读回', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const useImport = createImportStore({ useData, storage: s, suggest: async () => ({}), loadSamples: () => [] })
    const imp = useImport()
    await imp.run([{ name: 'c.txt', content: TXT }], 2025)
    expect(s.loadRawFiles()).toEqual([{ name: 'c.txt', content: TXT }])
    expect(imp.rawSavedCount).toBe(1) // 供导入页显示「已留存原文 X 个」
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

describe('run 导入后非阻塞触发分析', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('导入达标好友：status 先 done，分析在其后写入且样本已就绪（非空）', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const seen: string[][] = []
    const suggest = vi.fn(async (_f: unknown, samples: string[]) => { seen.push(samples); return { rel: '同事', role: 'PM' } })
    const useImport = createImportStore({
      useData, storage: s, suggest,
      loadSamples: makeSamples(s).loadSamplesFor,     // 真实：读回同一 memStorage
    })
    const imp = useImport()
    await imp.run([{ name: 'c.txt', content: BIG_TXT }], 2025)
    expect(imp.status).toBe('done')
    const big = useData().friends[0]
    expect(big.role).toBe('PM')                       // 后台分析已写入
    expect(seen.length).toBe(1)
    expect(seen[0].length).toBeGreaterThan(0)         // 分析时样本已落盘、非空（保留 Critical 回归）
    expect(s.loadAnalyzedIds()).toContain(big.id)
  })

  it('导入的好友都低于门槛：不分析、集合为空、status done', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const suggest = vi.fn().mockResolvedValue({ role: 'PM' })
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => [] })
    const imp = useImport()
    await imp.run([{ name: 'c.txt', content: TXT }], 2025) // 小 TXT：李四 2 条 < 20
    expect(imp.status).toBe('done')
    expect(suggest).not.toHaveBeenCalled()
    expect(s.loadAnalyzedIds()).toEqual([])
  })
})
