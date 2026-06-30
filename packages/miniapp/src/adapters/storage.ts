import type { Friend, ReportData } from '@nianlun/core'

const K_FRIENDS = 'nianlun:friends'
const K_REPORT = 'nianlun:report'
const K_SAMPLES = 'nianlun:samples'

export interface StorageBackend {
  get(key: string): unknown
  set(key: string, value: unknown): void
  remove(key: string): void
}

export function makeStorage(backend: StorageBackend) {
  return {
    saveFriends(friends: Friend[]): void { backend.set(K_FRIENDS, friends) },
    loadFriends(): Friend[] {
      const raw = (backend.get(K_FRIENDS) as Friend[] | undefined) ?? []
      return raw.map((f) => ({
        ...f,
        hourly: f.hourly ?? new Array(24).fill(0),
        weekHour: f.weekHour ?? new Array(168).fill(0),
        keywords: f.keywords ?? [],
      }))
    },
    saveReport(report: ReportData): void { backend.set(K_REPORT, report) },
    loadReport(): ReportData | null {
      return (backend.get(K_REPORT) as ReportData | undefined) ?? null
    },
    saveSamples(samples: Record<string, string[]>): void { backend.set(K_SAMPLES, samples) },
    loadSamples(): Record<string, string[]> {
      return (backend.get(K_SAMPLES) as Record<string, string[]> | undefined) ?? {}
    },
    clearAll(): void { backend.remove(K_FRIENDS); backend.remove(K_REPORT); backend.remove(K_SAMPLES) },
  }
}

const wxBackend: StorageBackend = {
  get: (k) => wx.getStorageSync(k),
  set: (k, v) => wx.setStorageSync(k, v),
  remove: (k) => wx.removeStorageSync(k),
}

export const storage = makeStorage(wxBackend)
