import type { Friend, ReportData } from '@nianlun/core'
import type { RecentInsight } from './parseLocal'

const K_FRIENDS = 'nianlun:friends'
const K_REPORT = 'nianlun:report'
const K_SAMPLES = 'nianlun:samples'
const K_RECENT_INSIGHTS = 'nianlun:recentInsights'
const K_RECENT_SAMPLES = 'nianlun:recentSamples'
const K_ANALYZED = 'nianlun:analyzedIds'
const K_RAW_INDEX = 'nianlun:rawIndex'
const K_RAW = (i: number) => `nianlun:raw:${i}`
// 单块字符数上限。小程序单键上限约 1MB(字节)；中文按 UTF-8 最多 4 字节/字，
// 取 20 万字符 → 最坏约 0.8MB，留足余量。
const RAW_CHUNK_CHARS = 200_000

/** 导入的原始聊天文件（名字 + 原文），供将来二级荐股分析重解析。 */
export interface RawChatFile { name: string; content: string }

export interface StorageBackend {
  get(key: string): unknown
  set(key: string, value: unknown): void
  remove(key: string): void
}

export function makeStorage(backend: StorageBackend) {
  // ── 原始聊天文本：分块存 Storage（绕过单键 1MB 限制）────────────────
  function rawChunkCount(): number {
    const idx = backend.get(K_RAW_INDEX)
    return idx && typeof idx === 'object' && typeof (idx as { count?: unknown }).count === 'number'
      ? (idx as { count: number }).count
      : 0
  }
  function clearRawImpl(): void {
    const count = rawChunkCount()
    for (let i = 0; i < count; i++) backend.remove(K_RAW(i))
    backend.remove(K_RAW_INDEX)
  }
  function loadRawFilesImpl(): RawChatFile[] {
    const count = rawChunkCount()
    if (!count) return []
    let blob = ''
    for (let i = 0; i < count; i++) {
      const c = backend.get(K_RAW(i))
      if (typeof c !== 'string') return [] // 缺块 → 容错返回空，绝不抛
      blob += c
    }
    try {
      const arr = JSON.parse(blob)
      return Array.isArray(arr) ? (arr as RawChatFile[]) : []
    } catch {
      return []
    }
  }
  function saveRawFilesImpl(files: RawChatFile[]): void {
    clearRawImpl() // 覆盖式：先清旧块，避免残留块拼接出错
    const blob = JSON.stringify(files)
    let count = 0
    for (let i = 0; i < blob.length; i += RAW_CHUNK_CHARS) {
      backend.set(K_RAW(count), blob.slice(i, i + RAW_CHUNK_CHARS))
      count++
    }
    backend.set(K_RAW_INDEX, { count })
  }
  function appendRawFilesImpl(files: RawChatFile[]): void {
    const existing = loadRawFilesImpl()
    const seen = new Set(existing.map((f) => f.content)) // 按内容精确去重(同一文件重复导入)
    const merged = [...existing, ...files.filter((f) => !seen.has(f.content))]
    saveRawFilesImpl(merged)
  }

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
    // 原始聊天文本：覆盖写 / 读回 / 追加去重 / 清除
    saveRawFiles(files: RawChatFile[]): void { saveRawFilesImpl(files) },
    loadRawFiles(): RawChatFile[] { return loadRawFilesImpl() },
    appendRawFiles(files: RawChatFile[]): void { appendRawFilesImpl(files) },
    clearRaw(): void { clearRawImpl() },
    clearAll(): void {
      backend.remove(K_FRIENDS); backend.remove(K_REPORT); backend.remove(K_SAMPLES)
      backend.remove(K_RECENT_INSIGHTS); backend.remove(K_RECENT_SAMPLES); backend.remove(K_ANALYZED)
      clearRawImpl()
    },
  }
}

const wxBackend: StorageBackend = {
  get: (k) => wx.getStorageSync(k),
  set: (k, v) => wx.setStorageSync(k, v),
  remove: (k) => wx.removeStorageSync(k),
}

export const storage = makeStorage(wxBackend)
