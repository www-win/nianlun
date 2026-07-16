import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate'
import { storage } from './storage'
import type { StorageSnapshot } from './storage'

export interface BackupEnvelope {
  version: 1
  createdAt: number
  kv: Record<string, unknown>
  files: Record<string, string>
}

export interface CloudBackupDeps {
  storage: { exportAll(): StorageSnapshot; importAll(s: StorageSnapshot): void; mergeAiResults(s: StorageSnapshot): void }
  /** 上传字节到逻辑路径（wx 实现映射到按用户隔离的云存储路径）。 */
  upload(cloudPath: string, bytes: Uint8Array): Promise<void>
  /** 下载逻辑路径的字节；不存在返回 null。 */
  download(cloudPath: string): Promise<Uint8Array | null>
  gzip(data: Uint8Array): Uint8Array
  gunzip(data: Uint8Array): Uint8Array
  now(): number
  /** 备份成功后记录本次采用的模式（单包/分块），供 restore 判断该走哪条路径。可选：不传则 restore 走旧的“先试单包再试 manifest”兼容逻辑。 */
  finalize?(mode: 'single' | 'chunked'): Promise<void>
  /** 读取云端记录的当前模式；无记录或未实现时返回 null，restore 退回兼容逻辑。 */
  resolveMode?(): Promise<'single' | 'chunked' | null>
}

const SINGLE_PATH = 'backup.json.gz'
const MANIFEST_PATH = 'manifest.json.gz'
const DEFAULT_BIG_THRESHOLD = 8 * 1024 * 1024
// 注意：小程序运行时没有 TextEncoder/TextDecoder（Web/Node 全局），故用 fflate 的
// strToU8/strFromU8 做 UTF-8 字符串↔字节，避免模块加载即抛 "TextEncoder is not defined"。

interface Manifest { version: 1; createdAt: number; chunked: true; fileNames: string[] }

export function makeCloudBackup(deps: CloudBackupDeps, opts: { bigThreshold?: number } = {}) {
  const bigThreshold = opts.bigThreshold ?? DEFAULT_BIG_THRESHOLD
  const gz = (obj: unknown) => deps.gzip(strToU8(JSON.stringify(obj)))
  const ungz = (bytes: Uint8Array) => JSON.parse(strFromU8(deps.gunzip(bytes)))

  function estimate(snap: StorageSnapshot): number {
    let n = JSON.stringify(snap.kv).length
    for (const v of Object.values(snap.files)) n += v.length
    return n
  }

  async function backup(): Promise<{ bytes: number }> {
    const local = deps.storage.exportAll()
    // 合并到云端已有快照之上：本机有的更新、本机没有的保留云端原值 → 备份「只增不减」。
    // 这样任何情况下都不会用「缺字段的本机快照」把云端已有数据覆盖没（例如换机后只恢复了好友、
    // report 尚未回来时触发的自动备份）。若云端读取失败（网络/权限），fetchSnapshot 抛错 →
    // 本次 backup 直接抛出中止、绝不上传，从而不破坏云端。云端确无备份时返回 null → 首次全量上传。
    const base = await fetchSnapshot()
    const snap: StorageSnapshot = base
      ? { kv: { ...base.kv, ...local.kv }, files: { ...base.files, ...local.files } }
      : local
    if (estimate(snap) <= bigThreshold) {
      const bytes = gz({ version: 1, createdAt: deps.now(), kv: snap.kv, files: snap.files } as BackupEnvelope)
      await deps.upload(SINGLE_PATH, bytes)
      await deps.finalize?.('single')
      return { bytes: bytes.length }
    }
    // 分块：每个文件数据集一个 part，KV 整体一个 part
    let total = 0
    const kvBytes = gz(snap.kv)
    await deps.upload('parts/kv.json.gz', kvBytes); total += kvBytes.length
    const fileNames = Object.keys(snap.files)
    for (const name of fileNames) {
      const b = gz(snap.files[name])
      await deps.upload(`parts/file-${name}.json.gz`, b); total += b.length
    }
    const manifest: Manifest = { version: 1, createdAt: deps.now(), chunked: true, fileNames }
    const mBytes = gz(manifest)
    await deps.upload(MANIFEST_PATH, mBytes); total += mBytes.length
    await deps.finalize?.('chunked')
    return { bytes: total }
  }

  // 取回云端快照 + 其 createdAt（不写本地），供 restore（覆盖）、restoreMerge（合并）、backup（合并基底）复用。
  // 云端无对应备份 → 返回 null；download 抛错（网络/权限等）会向上传播，让调用方（尤其 backup）中止而非覆盖。
  async function fetchSingleRaw(): Promise<{ snap: StorageSnapshot; createdAt: number } | null> {
    const single = await deps.download(SINGLE_PATH)
    if (!single) return null
    const env = ungz(single) as BackupEnvelope
    if (env.version !== 1) throw new Error(`不支持的备份版本：${env.version}`)
    return { snap: { kv: env.kv, files: env.files }, createdAt: env.createdAt }
  }
  async function fetchChunkedRaw(): Promise<{ snap: StorageSnapshot; createdAt: number } | null> {
    const mBytes = await deps.download(MANIFEST_PATH)
    if (!mBytes) return null
    const manifest = ungz(mBytes) as Manifest
    if (manifest.version !== 1) throw new Error(`不支持的备份版本：${manifest.version}`)
    const kvPart = await deps.download('parts/kv.json.gz')
    const kv = kvPart ? (ungz(kvPart) as Record<string, unknown>) : {}
    const files: Record<string, string> = {}
    for (const name of manifest.fileNames) {
      const b = await deps.download(`parts/file-${name}.json.gz`)
      if (b) files[name] = ungz(b) as string
    }
    return { snap: { kv, files }, createdAt: manifest.createdAt }
  }
  const fetchSingle = async (): Promise<StorageSnapshot | null> => (await fetchSingleRaw())?.snap ?? null
  const fetchChunked = async (): Promise<StorageSnapshot | null> => (await fetchChunkedRaw())?.snap ?? null

  async function fetchSnapshot(): Promise<StorageSnapshot | null> {
    const mode = deps.resolveMode ? await deps.resolveMode() : null
    if (mode === 'single') return fetchSingle()
    if (mode === 'chunked') return fetchChunked()
    // 无 mode 记录：单包与分块可能并存（跨阈值切换后旧包残留），取「createdAt 较新」的，
    // 避免旧包盖过新数据。两者皆无 → null。
    const s = await fetchSingleRaw()
    const c = await fetchChunkedRaw()
    if (!s && !c) return null
    if (s && c) return (c.createdAt >= s.createdAt ? c : s).snap
    return (s ?? c)!.snap
  }

  // 覆盖恢复：本地为空时用（换机/被清空）。
  async function restore(): Promise<boolean> {
    const snap = await fetchSnapshot()
    if (!snap) return false
    deps.storage.importAll(snap)
    return true
  }

  // 合并恢复：本地有数据时用，只补齐本地缺的 AI 结果（本地优先），避免重分析、不覆盖本地新数据。
  async function restoreMerge(): Promise<boolean> {
    const snap = await fetchSnapshot()
    if (!snap) return false
    deps.storage.mergeAiResults(snap)
    return true
  }

  return { backup, restore, restoreMerge }
}

// —— 真机 wx.cloud 接线（薄封装，真机验证；wx 惰性访问）——
// 需先在云开发控制台创建集合 nianlun_backup（权限：仅创建者可读写），并部署 getOpenId。
let cachedOpenId: string | undefined
async function wxOpenId(): Promise<string> {
  if (!cachedOpenId) {
    const res = await wx.cloud.callFunction({ name: 'getOpenId' })
    cachedOpenId = (res.result as { openid: string }).openid
  }
  return cachedOpenId
}
// 逻辑路径 → 云存储 cloudPath（按 openid 隔离）
async function cloudPathFor(logical: string): Promise<string> {
  const openid = await wxOpenId()
  return `nianlun-backup/${openid}/${logical}`
}
function tempFile(name: string): string { return `${wx.env.USER_DATA_PATH}/__bk_${name.replace(/\//g, '_')}` }

// 云存储 fileID 前缀 = cloud://{环境ID}.{存储桶ID}/。存储桶 ID 每个云环境固定不变，
// 可在任意一次 uploadFile 返回的 fileID 或云开发控制台「存储」里文件详情的 File ID 中看到。
// 用它 + openid + 路径即可推算出备份文件的 fileID，从而彻底不依赖数据库存指针。
// 换云环境时需同步改这里（与 App.vue 的 env 一致）。
const CLOUD_FILE_PREFIX = 'cloud://cloud1-d4gzww8dp909b47cb.636c-cloud1-d4gzww8dp909b47cb-1448757478/'

const wxDeps: CloudBackupDeps = {
  storage: { exportAll: () => storage.exportAll(), importAll: (s) => storage.importAll(s), mergeAiResults: (s) => storage.mergeAiResults(s) },
  gzip: (d) => gzipSync(d, { level: 4 }),
  gunzip: (d) => gunzipSync(d),
  now: () => Date.now(),
  upload: async (logical, bytes) => {
    const fm = wx.getFileSystemManager()
    const tmp = tempFile(logical)
    fm.writeFileSync(tmp, bytes.buffer as ArrayBuffer)          // 字节 → 临时文件
    try {
      const cloudPath = await cloudPathFor(logical)
      await wx.cloud.uploadFile({ cloudPath, filePath: tmp })   // 覆盖上传；fileID 可推算，无需存库
    } finally {
      try { fm.unlinkSync(tmp) } catch { /* ignore */ }
    }
  },
  download: async (logical) => {
    // 直接推算 fileID（前缀固定 + openid + 路径），不查数据库
    const fileID = `${CLOUD_FILE_PREFIX}${await cloudPathFor(logical)}`
    try {
      const res = await wx.cloud.downloadFile({ fileID })
      if (res.statusCode && res.statusCode !== 200) return null  // 文件不存在等
      const fm = wx.getFileSystemManager()
      const buf = fm.readFileSync(res.tempFilePath) as ArrayBuffer
      return new Uint8Array(buf)
    } catch { return null }  // 无此文件/网络错误 → 视作不存在（宽松：保证备份可用；防覆盖靠 backup 的「合并」层）
  },
  // 不再用 finalize/resolveMode：restore 退回「先试单包 backup.json.gz，再试 manifest」的兼容逻辑，
  // 靠 downloadFile 能否取到文件来判断走哪条路径，无需 mode 记录。
}

// ⚠️ 真机核对项（部署时逐条验证，微信基础库版本差异）：wx.cloud.uploadFile 的 cloudPath 覆盖语义、
// downloadFile({ fileID }) 返回 tempFilePath 与 statusCode、writeFileSync 接受 ArrayBuffer、
// CLOUD_FILE_PREFIX 的存储桶 ID 与当前云环境一致。
export const cloudBackup = makeCloudBackup(wxDeps)
