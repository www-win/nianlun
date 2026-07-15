import type { Friend, ReportData, BirthInfo, BaziChart, AstroReading, StockPick, Sentiment, FriendProfile, MbtiResult, RelationDeep } from '@nianlun/core'
import type { RecentInsight } from './parseLocal'
import { makeFsJson, makeKvFsJson, type FsJsonBackend } from './fsStore'
import { wxRawFs } from './rawStore'

const K_REPORT = 'nianlun:report'
const K_ANALYZED = 'nianlun:analyzedIds'
const K_FRIEND_SENTIMENT = 'nianlun:friendSentiment'
const K_FRIEND_PROFILE = 'nianlun:friendProfile'
const K_FRIEND_MBTI = 'nianlun:friendMbti'
const K_REPORT_COPY = 'nianlun:reportCopy'
const K_YEAR_MOOD = 'nianlun:yearMood'
const K_FRIEND_RELATION_DEEP = 'nianlun:friendRelationDeep'
// 旧版本把原文分块存 Storage 用的键（现已迁至文件系统）；启动时清理这些残留以回收配额。
const K_RAW_INDEX_LEGACY = 'nianlun:rawIndex'
const K_RAW_PREFIX_LEGACY = 'nianlun:raw:'
const K_MY_BAZI = 'nianlun:myBazi'
const K_BIRTHS = 'nianlun:births'
const K_ASTRO = 'nianlun:astro'
const K_LAST_BACKUP_AT = 'nianlun:lastBackupAt'
// 旧版本把大数据存 Storage 单键用的键（现已迁至文件系统）；启动时清理这些残留以回收配额。
const LEGACY_BIG_KEYS = ['nianlun:friends', 'nianlun:samples', 'nianlun:recentInsights', 'nianlun:recentSamples', 'nianlun:stocks']

// 四张好友级 AI 结果表迁至文件系统（无 KV 单键 1MB 限制）：KV 键 → 文件数据集名。
// 全量自动分析后这些表可能很大，存 KV 会撞 1MB 上限写失败→结果丢→重分析；文件无此限。
const AI_RESULT_FILES: Record<string, string> = {
  [K_FRIEND_SENTIMENT]: 'friendSentiment',
  [K_FRIEND_PROFILE]: 'friendProfile',
  [K_FRIEND_MBTI]: 'friendMbti',
  [K_FRIEND_RELATION_DEEP]: 'friendRelationDeep',
}

/** 进备份的「大数据文件」数据集清单；新增文件数据集须在此登记。 */
export const BACKUP_FILE_DATASETS = [
  'friends', 'samples', 'recentInsights', 'recentSamples', 'stocks',
  'friendSentiment', 'friendProfile', 'friendMbti', 'friendRelationDeep',
] as const
export interface StorageSnapshot { kv: Record<string, unknown>; files: Record<string, string> }

const LEGACY_KV_PREFIXES = ['nianlun:raw:', 'nianlun:fsjson:']
const LEGACY_KV_EXACT = new Set<string>(['nianlun:rawIndex', ...LEGACY_BIG_KEYS])
function isBackupKvKey(k: string): boolean {
  if (!k.startsWith('nianlun:')) return false
  if (LEGACY_KV_EXACT.has(k)) return false
  return !LEGACY_KV_PREFIXES.some((p) => k.startsWith(p))
}

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

export function makeStorage(
  backend: StorageBackend,
  fs: FsJsonBackend = makeKvFsJson(backend),
  schedule: (fn: () => void, ms: number) => { cancel: () => void } =
    (fn, ms) => { const t = setTimeout(fn, ms); return { cancel: () => clearTimeout(t) } },
) {
  // ── 四类 AI 结果持久化：指纹 + 好友级/报告级通用读写 ──────────────
  // 指纹 = 生成时喂给 AI 的输入的轻量摘要；输入不变则缓存新鲜。
  const friendFp = (f: Friend): string => `${f.msgCount}:${f.lastContact}`
  const reportFp = (r: ReportData): string => `${r.totalMessages}:${r.friendCount}:${r.activeDays}`
  // AI 结果落盘后触发的钩子（供 App 接到「排一次防抖云备份」）。绕过 data store 的 onSaved，
  // 因为这些结果走 storage.set 直存、不经 data store。触发失败不影响本地保存。
  let onChanged: (() => void) | null = null
  const fireChanged = () => { try { onChanged?.() } catch { /* 备份触发失败不影响本地保存 */ } }

  const FLUSH_MS = 800
  // 四张好友级表的写缓冲：key -> { id -> {data, fp} }。debounce 合并写，减少高频整表同步写卡顿。
  // read-through：读时叠加在已存之上，flush 前也能读到刚写的值。
  const pending: Record<string, Record<string, { data: unknown; fp: string }>> = {}
  let flushHandle: { cancel: () => void } | null = null
  function scheduleFlush(): void {
    if (flushHandle) return
    flushHandle = schedule(() => { flushHandle = null; flushNow() }, FLUSH_MS)
  }
  function bufferFriendEntry(key: string, id: string, friend: Friend, data: unknown): void {
    const bucket = pending[key] ?? (pending[key] = {})
    bucket[id] = { data, fp: friendFp(friend) }
    scheduleFlush()
  }
  function flushNow(): void {
    const keys = Object.keys(pending)
    if (keys.length === 0) return
    for (const key of keys) {
      const merged = { ...loadFriendMapStored(key), ...pending[key] }
      fs.write(AI_RESULT_FILES[key], merged)   // 写文件系统（无 1MB 单键限制），不再写 KV
      delete pending[key]
    }
    if (flushHandle) { flushHandle.cancel(); flushHandle = null }
    fireChanged()   // 合并后的一次落盘 → 排一次防抖备份
  }
  // 已存部分（不含缓冲），供 flushNow 合并用，避免与 read-through 版本互相递归。从文件系统读。
  function loadFriendMapStored(key: string): Record<string, { data: unknown; fp: string }> {
    const raw = fs.read(AI_RESULT_FILES[key])
    return raw && typeof raw === 'object' ? (raw as Record<string, { data: unknown; fp: string }>) : {}
  }
  // 好友级：键存 { [id]: { data, fp } }，按当前 friend 现算 fp 比对新鲜度。read-through：叠加缓冲。
  function loadFriendMap(key: string): Record<string, { data: unknown; fp: string }> {
    const stored = loadFriendMapStored(key)
    const buf = pending[key]
    return buf ? { ...stored, ...buf } : stored
  }
  function saveFriendEntry(key: string, id: string, friend: Friend, data: unknown): void {
    bufferFriendEntry(key, id, friend, data)   // 缓冲 + debounce flush（原整表同步写已下沉到 flushNow）
  }
  function loadFriendEntry<T>(key: string, id: string, friend: Friend): { data: T; stale: boolean } | null {
    const entry = loadFriendMap(key)[id]
    if (!entry || typeof entry !== 'object') return null
    return { data: entry.data as T, stale: entry.fp !== friendFp(friend) }
  }
  // 报告级：单键存 { text, fp }。
  function saveReportEntry(key: string, report: ReportData, text: string): void {
    backend.set(key, { text, fp: reportFp(report) })
    fireChanged()   // 年度文案/全年情绪 AI 结果落盘 → 排一次备份
  }
  function loadReportEntry(key: string, report: ReportData): { data: string; stale: boolean } | null {
    const raw = backend.get(key)
    if (!raw || typeof raw !== 'object') return null
    const e = raw as { text?: unknown; fp?: unknown }
    if (typeof e.text !== 'string') return null
    return { data: e.text, stale: e.fp !== reportFp(report) }
  }

  return {
    // 注册 AI 结果落盘后的回调（App 里接到 backupStore.scheduleBackup，防抖合并）。
    setOnChanged(fn: () => void): void { onChanged = fn },
    // 把好友级 AI 结果缓冲立即落盘（供 App 退后台/队列排空时调用），合并触发一次 fireChanged。
    flushNow(): void { flushNow() },
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
    saveStockPicks(picks: StockPick[]): void { fs.write('stocks', picks); fireChanged() },
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
    // 把多个 id 并入已存的 analyzedIds（去重）后一次写；自读 backend，不依赖 this。
    addAnalyzedIds(ids: string[]): void {
      const raw = backend.get(K_ANALYZED)
      const base = Array.isArray(raw) ? (raw as string[]) : []
      backend.set(K_ANALYZED, [...new Set([...base, ...ids])])
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
    saveAstroReading(map: Record<string, StoredAstroReading>): void { backend.set(K_ASTRO, map); fireChanged() },
    loadAstroReading(): Record<string, StoredAstroReading> {
      const raw = backend.get(K_ASTRO)
      return raw && typeof raw === 'object' ? (raw as Record<string, StoredAstroReading>) : {}
    },
    saveLastBackupAt(t: number): void { backend.set(K_LAST_BACKUP_AT, t) },
    loadLastBackupAt(): number | null {
      const v = backend.get(K_LAST_BACKUP_AT)
      return typeof v === 'number' ? v : null
    },

    // —— 四类 AI 结果：好友级(情绪/画像) + 报告级(文案/全年情绪)，命中缓存免重复调用 ——
    saveFriendSentiment(id: string, friend: Friend, data: Sentiment): void {
      saveFriendEntry(K_FRIEND_SENTIMENT, id, friend, data)
    },
    loadFriendSentiment(id: string, friend: Friend): { data: Sentiment; stale: boolean } | null {
      return loadFriendEntry<Sentiment>(K_FRIEND_SENTIMENT, id, friend)
    },
    saveFriendProfile(id: string, friend: Friend, data: FriendProfile): void {
      saveFriendEntry(K_FRIEND_PROFILE, id, friend, data)
    },
    loadFriendProfile(id: string, friend: Friend): { data: FriendProfile; stale: boolean } | null {
      return loadFriendEntry<FriendProfile>(K_FRIEND_PROFILE, id, friend)
    },
    saveFriendMbti(id: string, friend: Friend, data: MbtiResult): void {
      saveFriendEntry(K_FRIEND_MBTI, id, friend, data)
    },
    loadFriendMbti(id: string, friend: Friend): { data: MbtiResult; stale: boolean } | null {
      return loadFriendEntry<MbtiResult>(K_FRIEND_MBTI, id, friend)
    },
    // 批量读整表：{ [id]: MbtiResult }，只触发 1 次 backend.get。
    // 好友列表页给全部好友取 MBTI 时用它，避免每人一次同步 getStorageSync 阻塞主线程。
    loadFriendMbtiMap(): Record<string, MbtiResult> {
      const all = loadFriendMap(K_FRIEND_MBTI)
      const out: Record<string, MbtiResult> = {}
      for (const id in all) out[id] = all[id].data as MbtiResult
      return out
    },
    // 以下三个整表批量读语义同 loadFriendMbtiMap：一次 backend.get 拿整表，丢弃 fp 元数据。
    // scan 判定「已分析」用它们，避免每好友每功能各一次同步 getStorageSync（防卡）。
    loadFriendSentimentMap(): Record<string, Sentiment> {
      const all = loadFriendMap(K_FRIEND_SENTIMENT)
      const out: Record<string, Sentiment> = {}
      for (const id in all) out[id] = all[id].data as Sentiment
      return out
    },
    loadFriendProfileMap(): Record<string, FriendProfile> {
      const all = loadFriendMap(K_FRIEND_PROFILE)
      const out: Record<string, FriendProfile> = {}
      for (const id in all) out[id] = all[id].data as FriendProfile
      return out
    },
    loadRelationDeepMap(): Record<string, RelationDeep> {
      const all = loadFriendMap(K_FRIEND_RELATION_DEEP)
      const out: Record<string, RelationDeep> = {}
      for (const id in all) out[id] = all[id].data as RelationDeep
      return out
    },
    saveRelationDeep(id: string, friend: Friend, data: RelationDeep): void {
      saveFriendEntry(K_FRIEND_RELATION_DEEP, id, friend, data)
    },
    loadRelationDeep(id: string, friend: Friend): { data: RelationDeep; stale: boolean } | null {
      return loadFriendEntry<RelationDeep>(K_FRIEND_RELATION_DEEP, id, friend)
    },
    saveReportCopy(report: ReportData, text: string): void { saveReportEntry(K_REPORT_COPY, report, text) },
    loadReportCopy(report: ReportData): { data: string; stale: boolean } | null {
      return loadReportEntry(K_REPORT_COPY, report)
    },
    saveYearMood(report: ReportData, text: string): void { saveReportEntry(K_YEAR_MOOD, report, text) },
    loadYearMood(report: ReportData): { data: string; stale: boolean } | null {
      return loadReportEntry(K_YEAR_MOOD, report)
    },

    clearAll(): void {
      backend.remove(K_REPORT); backend.remove(K_ANALYZED)
      backend.remove(K_MY_BAZI); backend.remove(K_BIRTHS); backend.remove(K_ASTRO)
      backend.remove(K_FRIEND_SENTIMENT); backend.remove(K_FRIEND_PROFILE); backend.remove(K_FRIEND_MBTI)
      backend.remove(K_FRIEND_RELATION_DEEP)
      backend.remove(K_REPORT_COPY); backend.remove(K_YEAR_MOOD)
      backend.remove(K_LAST_BACKUP_AT)
      fs.remove('friends'); fs.remove('samples'); fs.remove('recentInsights'); fs.remove('recentSamples'); fs.remove('stocks')
      // 四张 AI 结果表现存文件系统，一并清除。
      for (const dataset of Object.values(AI_RESULT_FILES)) fs.remove(dataset)
      // 未落盘的好友级缓冲也要清掉，否则残留的缓冲会在下次 read-through/flush 时把已清空的数据带回来。
      if (flushHandle) { flushHandle.cancel(); flushHandle = null }
      for (const key of Object.keys(pending)) delete pending[key]
    },
    exportAll(): StorageSnapshot {
      const kv: Record<string, unknown> = {}
      const keys = backend.keys?.() ?? []
      for (const k of keys) if (isBackupKvKey(k)) kv[k] = backend.get(k)
      const files: Record<string, string> = {}
      for (const name of BACKUP_FILE_DATASETS) {
        const raw = fs.readRaw(name)
        if (raw !== undefined) files[name] = raw
      }
      return { kv, files }
    },
    importAll(snap: StorageSnapshot): void {
      for (const [k, v] of Object.entries(snap.kv ?? {})) backend.set(k, v)
      for (const [name, raw] of Object.entries(snap.files ?? {})) fs.writeRaw(name, raw)
    },
    /** 删除旧版本存 KV 单键的大数据（现已迁文件），回收配额。真机启动调用一次。 */
    purgeLegacyBigKeys(): void { for (const k of LEGACY_BIG_KEYS) backend.remove(k) },
    /**
     * 一次性把四张 AI 结果表从旧的 KV 单键搬到文件系统（去掉 1MB 限制）。真机启动调用一次。
     * 文件已有数据的优先保留（新数据不被旧 KV 覆盖）；搬完删掉 KV 键回收配额。
     * 注意：撞过 1MB 的大表当初可能压根没写进 KV，这里能搬多少搬多少，缺的靠云端合并恢复补齐。
     */
    migrateAiResultsToFs(): void {
      for (const [kvKey, dataset] of Object.entries(AI_RESULT_FILES)) {
        const kvData = backend.get(kvKey)
        if (!kvData || typeof kvData !== 'object' || Object.keys(kvData).length === 0) continue
        const existing = fs.read(dataset)
        const existingMap = existing && typeof existing === 'object' ? (existing as Record<string, unknown>) : {}
        fs.write(dataset, { ...(kvData as Record<string, unknown>), ...existingMap })  // 文件已有的优先
        backend.remove(kvKey)
      }
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
  readRaw: (n) => realFsJson().readRaw(n),
  writeRaw: (n, r) => realFsJson().writeRaw(n, r),
}

export const storage = makeStorage(wxBackend, wxFsJson)
