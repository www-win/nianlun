import { gzipSync, gunzipSync } from 'fflate'
import { storage } from './storage'
import type { StorageSnapshot } from './storage'

export interface BackupEnvelope {
  version: 1
  createdAt: number
  kv: Record<string, unknown>
  files: Record<string, string>
}

export interface CloudBackupDeps {
  storage: { exportAll(): StorageSnapshot; importAll(s: StorageSnapshot): void }
  /** 上传字节到逻辑路径（wx 实现映射到按用户隔离的云存储路径）。 */
  upload(cloudPath: string, bytes: Uint8Array): Promise<void>
  /** 下载逻辑路径的字节；不存在返回 null。 */
  download(cloudPath: string): Promise<Uint8Array | null>
  gzip(data: Uint8Array): Uint8Array
  gunzip(data: Uint8Array): Uint8Array
  now(): number
}

const SINGLE_PATH = 'backup.json.gz'
const MANIFEST_PATH = 'manifest.json.gz'
const DEFAULT_BIG_THRESHOLD = 8 * 1024 * 1024
const enc = new TextEncoder()
const dec = new TextDecoder()

interface Manifest { version: 1; createdAt: number; chunked: true; kvKeys: string[]; fileNames: string[] }

export function makeCloudBackup(deps: CloudBackupDeps, opts: { bigThreshold?: number } = {}) {
  const bigThreshold = opts.bigThreshold ?? DEFAULT_BIG_THRESHOLD
  const gz = (obj: unknown) => deps.gzip(enc.encode(JSON.stringify(obj)))
  const ungz = (bytes: Uint8Array) => JSON.parse(dec.decode(deps.gunzip(bytes)))

  function estimate(snap: StorageSnapshot): number {
    let n = JSON.stringify(snap.kv).length
    for (const v of Object.values(snap.files)) n += v.length
    return n
  }

  async function backup(): Promise<{ bytes: number }> {
    const snap = deps.storage.exportAll()
    if (estimate(snap) <= bigThreshold) {
      const bytes = gz({ version: 1, createdAt: deps.now(), kv: snap.kv, files: snap.files } as BackupEnvelope)
      await deps.upload(SINGLE_PATH, bytes)
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
    const manifest: Manifest = { version: 1, createdAt: deps.now(), chunked: true, kvKeys: Object.keys(snap.kv), fileNames }
    const mBytes = gz(manifest)
    await deps.upload(MANIFEST_PATH, mBytes); total += mBytes.length
    return { bytes: total }
  }

  async function restore(): Promise<boolean> {
    const single = await deps.download(SINGLE_PATH)
    if (single) {
      const env = ungz(single) as BackupEnvelope
      if (env.version !== 1) throw new Error(`不支持的备份版本：${env.version}`)
      deps.storage.importAll({ kv: env.kv, files: env.files })
      return true
    }
    const mBytes = await deps.download(MANIFEST_PATH)
    if (!mBytes) return false
    const manifest = ungz(mBytes) as Manifest
    if (manifest.version !== 1) throw new Error(`不支持的备份版本：${manifest.version}`)
    const kvPart = await deps.download('parts/kv.json.gz')
    const kv = kvPart ? (ungz(kvPart) as Record<string, unknown>) : {}
    const files: Record<string, string> = {}
    for (const name of manifest.fileNames) {
      const b = await deps.download(`parts/file-${name}.json.gz`)
      if (b) files[name] = ungz(b) as string
    }
    deps.storage.importAll({ kv, files })
    return true
  }

  return { backup, restore }
}

// —— 真机 wx.cloud 接线（薄封装，真机验证；wx 惰性访问）——
// 需先在云开发控制台创建集合 nianlun_backup（权限：仅创建者可读写），并部署 getOpenId。
async function wxOpenId(): Promise<string> {
  const res = await wx.cloud.callFunction({ name: 'getOpenId' })
  return (res.result as { openid: string }).openid
}
// 逻辑路径 → 云存储 cloudPath（按 openid 隔离）
async function cloudPathFor(logical: string): Promise<string> {
  const openid = await wxOpenId()
  return `nianlun-backup/${openid}/${logical}`
}
function tempFile(name: string): string { return `${wx.env.USER_DATA_PATH}/__bk_${name.replace(/\//g, '_')}` }

const wxDeps: CloudBackupDeps = {
  storage: { exportAll: () => storage.exportAll(), importAll: (s) => storage.importAll(s) },
  gzip: (d) => gzipSync(d, { level: 4 }),
  gunzip: (d) => gunzipSync(d),
  now: () => Date.now(),
  upload: async (logical, bytes) => {
    const fm = wx.getFileSystemManager()
    const tmp = tempFile(logical)
    fm.writeFileSync(tmp, bytes.buffer as ArrayBuffer)          // 字节 → 临时文件
    const cloudPath = await cloudPathFor(logical)
    const up = await wx.cloud.uploadFile({ cloudPath, filePath: tmp })
    fm.unlinkSync(tmp)
    // 记录 fileID 指针到数据库（供恢复按逻辑路径找回）
    const db = wx.cloud.database()
    await db.collection('nianlun_backup').doc('self').set({ data: { [dbField(logical)]: up.fileID, updatedAt: Date.now() } })
      .catch(() => db.collection('nianlun_backup').add({ data: { _id: 'self', [dbField(logical)]: up.fileID } }))
  },
  download: async (logical) => {
    const db = wx.cloud.database()
    let rec: any
    try { rec = (await db.collection('nianlun_backup').doc('self').get()).data } catch { return null }
    const fileID = rec?.[dbField(logical)]
    if (!fileID) return null
    try {
      const res = await wx.cloud.downloadFile({ fileID })
      const fm = wx.getFileSystemManager()
      const buf = fm.readFileSync(res.tempFilePath) as ArrayBuffer
      return new Uint8Array(buf)
    } catch { return null }
  },
}
/** 逻辑路径 → 数据库字段名（点/斜杠不合法，做映射）。 */
function dbField(logical: string): string { return 'f_' + logical.replace(/[^a-zA-Z0-9]/g, '_') }

// ⚠️ 真机核对项（部署时逐条验证，微信基础库版本差异）：wx.cloud.uploadFile 的 cloudPath 覆盖语义、
// downloadFile({ fileID }) 返回 tempFilePath、writeFileSync 接受 ArrayBuffer、数据库 doc('self')
// 固定 id 的 set/add 幂等。若 doc('self').set 在无记录时报错，用上面的 .catch(add) 兜底；确认后可简化。
export const cloudBackup = makeCloudBackup(wxDeps)
