import type { Friend, ReportData, BirthInfo, BaziChart, AstroReading, StockPick } from '@nianlun/core'
import type { RecentInsight } from './parseLocal'
import { makeFsJson, makeKvFsJson, type FsJsonBackend } from './fsStore'
import { wxRawFs } from './rawStore'

const K_REPORT = 'nianlun:report'
const K_ANALYZED = 'nianlun:analyzedIds'
// 旧版本把原文分块存 Storage 用的键（现已迁至文件系统）；启动时清理这些残留以回收配额。
const K_RAW_INDEX_LEGACY = 'nianlun:rawIndex'
const K_RAW_PREFIX_LEGACY = 'nianlun:raw:'
const K_MY_BAZI = 'nianlun:myBazi'
const K_BIRTHS = 'nianlun:births'
const K_ASTRO = 'nianlun:astro'
// 旧版本把大数据存 Storage 单键用的键（现已迁至文件系统）；启动时清理这些残留以回收配额。
const LEGACY_BIG_KEYS = ['nianlun:friends', 'nianlun:samples', 'nianlun:recentInsights', 'nianlun:recentSamples', 'nianlun:stocks']

/** 持久化的命理解读缓存（含时效元数据）。 */
export interface StoredAstroReading {
  reading: AstroReading
  chart: BaziChart              // 命盘速览，随解读一起缓存
  generatedDate: string         // 'YYYY-MM-DD'
  birthFingerprint: string      // 好友生辰指纹
  myBaziFingerprint: string     // 我的盘指纹
}

export interface StorageBackend {
  get(key: string): unknown
  set(key: string, value: unknown): void
  remove(key: string): void
  /** 列出所有键，用于清理旧版遗留键；backend 不支持则可省略（走 count 兜底）。 */
  keys?(): string[]
}

export function makeStorage(backend: StorageBackend, fs: FsJsonBackend = makeKvFsJson(backend)) {
  return {
    // —— 大数据：文件后端 ——
    saveFriends(friends: Friend[]): void { fs.write('friends', friends) },
    loadFriends(): Friend[] {
      const raw = fs.read('friends')
      const arr = Array.isArray(raw) ? (raw as Friend[]) : []
      return arr.map((f) => ({
        ...f,
        hourly: f.hourly ?? new Array(24).fill(0),
        weekHour: f.weekHour ?? new Array(168).fill(0),
        keywords: f.keywords ?? [],
      }))
    },
    saveSamples(samples: Record<string, string[]>): void { fs.write('samples', samples) },
    loadSamples(): Record<string, string[]> {
      const raw = fs.read('samples')
      return raw && typeof raw === 'object' ? (raw as Record<string, string[]>) : {}
    },
    saveRecentInsights(m: Record<string, RecentInsight>): void { fs.write('recentInsights', m) },
    loadRecentInsights(): Record<string, RecentInsight> {
      const raw = fs.read('recentInsights')
      return raw && typeof raw === 'object' ? (raw as Record<string, RecentInsight>) : {}
    },
    saveRecentSamples(m: Record<string, string[]>): void { fs.write('recentSamples', m) },
    loadRecentSamples(): Record<string, string[]> {
      const raw = fs.read('recentSamples')
      return raw && typeof raw === 'object' ? (raw as Record<string, string[]>) : {}
    },
    saveStockPicks(picks: StockPick[]): void { fs.write('stocks', picks) },
    loadStockPicks(): StockPick[] {
      const raw = fs.read('stocks')
      return Array.isArray(raw) ? (raw as StockPick[]) : []
    },
    clearStockPicks(): void { fs.remove('stocks') },

    // —— 小元数据：KV（保持不变）——
    saveReport(report: ReportData): void { backend.set(K_REPORT, report) },
    loadReport(): ReportData | null {
      const raw = backend.get(K_REPORT)
      return raw && typeof raw === 'object' ? (raw as ReportData) : null
    },
    saveAnalyzedIds(ids: string[]): void { backend.set(K_ANALYZED, ids) },
    loadAnalyzedIds(): string[] {
      const raw = backend.get(K_ANALYZED)
      return Array.isArray(raw) ? (raw as string[]) : []
    },
    saveMyBazi(b: BirthInfo): void { backend.set(K_MY_BAZI, b) },
    loadMyBazi(): BirthInfo | null {
      const raw = backend.get(K_MY_BAZI)
      return raw && typeof raw === 'object' ? (raw as BirthInfo) : null
    },
    saveBirths(m: Record<string, BirthInfo>): void { backend.set(K_BIRTHS, m) },
    loadBirths(): Record<string, BirthInfo> {
      const raw = backend.get(K_BIRTHS)
      return raw && typeof raw === 'object' ? (raw as Record<string, BirthInfo>) : {}
    },
    saveAstroReading(map: Record<string, StoredAstroReading>): void { backend.set(K_ASTRO, map) },
    loadAstroReading(): Record<string, StoredAstroReading> {
      const raw = backend.get(K_ASTRO)
      return raw && typeof raw === 'object' ? (raw as Record<string, StoredAstroReading>) : {}
    },

    clearAll(): void {
      backend.remove(K_REPORT); backend.remove(K_ANALYZED)
      backend.remove(K_MY_BAZI); backend.remove(K_BIRTHS); backend.remove(K_ASTRO)
      fs.remove('friends'); fs.remove('samples'); fs.remove('recentInsights'); fs.remove('recentSamples'); fs.remove('stocks')
    },
    /** 删除旧版本存 KV 单键的大数据（现已迁文件），回收配额。真机启动调用一次。 */
    purgeLegacyBigKeys(): void { for (const k of LEGACY_BIG_KEYS) backend.remove(k) },
    /**
     * 清掉旧版本（原文存 Storage）遗留的 nianlun:raw:* / nianlun:rawIndex 键，回收配额。
     * 原文已迁至文件系统，这些是死数据；真机无 Console 手动清，故 App 启动时自动调用。
     * 优先按 keys 精确清；backend 不支持列键时按 rawIndex.count 兜底删块。
     */
    purgeLegacyRaw(): void {
      const keys = backend.keys?.()
      if (keys) {
        for (const k of keys) {
          if (k === K_RAW_INDEX_LEGACY || k.startsWith(K_RAW_PREFIX_LEGACY)) backend.remove(k)
        }
        return
      }
      const idx = backend.get(K_RAW_INDEX_LEGACY)
      const count = idx && typeof idx === 'object' && typeof (idx as { count?: unknown }).count === 'number'
        ? (idx as { count: number }).count : 0
      for (let i = 0; i < count; i++) backend.remove(`${K_RAW_PREFIX_LEGACY}${i}`)
      backend.remove(K_RAW_INDEX_LEGACY)
    },
  }
}

const wxBackend: StorageBackend = {
  get: (k) => wx.getStorageSync(k),
  set: (k, v) => {
    try {
      wx.setStorageSync(k, v)
    } catch (e) {
      // 诊断：真机报 entry size limit(单键>1MB)时，暴露是哪个键、多大。排查完删。
      // eslint-disable-next-line no-console
      console.error('[storage] set 失败 key=' + k + ' size=' + (JSON.stringify(v).length / 1024).toFixed(0) + 'KB', (e as Error).message)
      throw e
    }
  },
  remove: (k) => wx.removeStorageSync(k),
  keys: () => { try { return wx.getStorageInfoSync().keys } catch { return [] } },
}

// 真机文件系统 JSON 后端（懒加载：方法体内才碰 wx）。
let cachedFsJson: FsJsonBackend | undefined
function realFsJson(): FsJsonBackend {
  if (!cachedFsJson) cachedFsJson = makeFsJson(wxRawFs, `${wx.env.USER_DATA_PATH}/nianlun_store`)
  return cachedFsJson
}
const wxFsJson: FsJsonBackend = {
  read: (n) => realFsJson().read(n),
  write: (n, d) => realFsJson().write(n, d),
  remove: (n) => realFsJson().remove(n),
}

export const storage = makeStorage(wxBackend, wxFsJson)
