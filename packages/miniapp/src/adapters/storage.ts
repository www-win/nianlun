import type { Friend, ReportData, BirthInfo, BaziChart, AstroReading, StockPick } from '@nianlun/core'
import type { RecentInsight } from './parseLocal'

const K_FRIENDS = 'nianlun:friends'
const K_REPORT = 'nianlun:report'
const K_SAMPLES = 'nianlun:samples'
const K_RECENT_INSIGHTS = 'nianlun:recentInsights'
const K_RECENT_SAMPLES = 'nianlun:recentSamples'
const K_ANALYZED = 'nianlun:analyzedIds'
// 旧版本把原文分块存 Storage 用的键（现已迁至文件系统）；启动时清理这些残留以回收配额。
const K_RAW_INDEX_LEGACY = 'nianlun:rawIndex'
const K_RAW_PREFIX_LEGACY = 'nianlun:raw:'
const K_MY_BAZI = 'nianlun:myBazi'
const K_BIRTHS = 'nianlun:births'
const K_ASTRO = 'nianlun:astro'
const K_STOCKS = 'nianlun:stocks'

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

export function makeStorage(backend: StorageBackend) {
  return {
    saveFriends(friends: Friend[]): void { backend.set(K_FRIENDS, friends) },
    loadFriends(): Friend[] {
      // wx.getStorageSync 对缺失键返回 ''（非 undefined），?? 挡不住，故按类型兜底。
      const raw = backend.get(K_FRIENDS)
      const arr = Array.isArray(raw) ? (raw as Friend[]) : []
      return arr.map((f) => ({
        ...f,
        hourly: f.hourly ?? new Array(24).fill(0),
        weekHour: f.weekHour ?? new Array(168).fill(0),
        keywords: f.keywords ?? [],
      }))
    },
    saveReport(report: ReportData): void { backend.set(K_REPORT, report) },
    loadReport(): ReportData | null {
      const raw = backend.get(K_REPORT)
      return raw && typeof raw === 'object' ? (raw as ReportData) : null
    },
    saveSamples(samples: Record<string, string[]>): void { backend.set(K_SAMPLES, samples) },
    loadSamples(): Record<string, string[]> {
      const raw = backend.get(K_SAMPLES)
      return raw && typeof raw === 'object' ? (raw as Record<string, string[]>) : {}
    },
    saveRecentInsights(m: Record<string, RecentInsight>): void { backend.set(K_RECENT_INSIGHTS, m) },
    loadRecentInsights(): Record<string, RecentInsight> {
      const raw = backend.get(K_RECENT_INSIGHTS)
      return raw && typeof raw === 'object' ? (raw as Record<string, RecentInsight>) : {}
    },
    saveRecentSamples(m: Record<string, string[]>): void { backend.set(K_RECENT_SAMPLES, m) },
    loadRecentSamples(): Record<string, string[]> {
      const raw = backend.get(K_RECENT_SAMPLES)
      return raw && typeof raw === 'object' ? (raw as Record<string, string[]>) : {}
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
    saveStockPicks(picks: StockPick[]): void { backend.set(K_STOCKS, picks) },
    loadStockPicks(): StockPick[] {
      const raw = backend.get(K_STOCKS)
      return Array.isArray(raw) ? (raw as StockPick[]) : []
    },
    clearStockPicks(): void { backend.remove(K_STOCKS) },
    clearAll(): void {
      backend.remove(K_FRIENDS); backend.remove(K_REPORT); backend.remove(K_SAMPLES)
      backend.remove(K_RECENT_INSIGHTS); backend.remove(K_RECENT_SAMPLES); backend.remove(K_ANALYZED)
      backend.remove(K_MY_BAZI); backend.remove(K_BIRTHS); backend.remove(K_ASTRO); backend.remove(K_STOCKS)
    },
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
  set: (k, v) => wx.setStorageSync(k, v),
  remove: (k) => wx.removeStorageSync(k),
  keys: () => { try { return wx.getStorageInfoSync().keys } catch { return [] } },
}

export const storage = makeStorage(wxBackend)
