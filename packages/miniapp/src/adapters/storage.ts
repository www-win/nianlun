import type { Friend, ReportData } from '@nianlun/core'
import type { RecentInsight } from './parseLocal'

const K_FRIENDS = 'nianlun:friends'
const K_REPORT = 'nianlun:report'
const K_SAMPLES = 'nianlun:samples'
const K_RECENT_INSIGHTS = 'nianlun:recentInsights'
const K_RECENT_SAMPLES = 'nianlun:recentSamples'
const K_ANALYZED = 'nianlun:analyzedIds'

export interface StorageBackend {
  get(key: string): unknown
  set(key: string, value: unknown): void
  remove(key: string): void
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
    clearAll(): void {
      backend.remove(K_FRIENDS); backend.remove(K_REPORT); backend.remove(K_SAMPLES)
      backend.remove(K_RECENT_INSIGHTS); backend.remove(K_RECENT_SAMPLES); backend.remove(K_ANALYZED)
    },
  }
}

const wxBackend: StorageBackend = {
  get: (k) => wx.getStorageSync(k),
  set: (k, v) => wx.setStorageSync(k, v),
  remove: (k) => wx.removeStorageSync(k),
}

export const storage = makeStorage(wxBackend)
