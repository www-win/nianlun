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
const enc = new TextEncoder()
const dec = new TextDecoder()

export function makeCloudBackup(deps: CloudBackupDeps) {
  async function backup(): Promise<{ bytes: number }> {
    const snap = deps.storage.exportAll()
    const env: BackupEnvelope = { version: 1, createdAt: deps.now(), kv: snap.kv, files: snap.files }
    const bytes = deps.gzip(enc.encode(JSON.stringify(env)))
    await deps.upload(SINGLE_PATH, bytes)
    return { bytes: bytes.length }
  }

  async function restore(): Promise<boolean> {
    const bytes = await deps.download(SINGLE_PATH)
    if (!bytes) return false
    const env = JSON.parse(dec.decode(deps.gunzip(bytes))) as BackupEnvelope
    if (env.version !== 1) throw new Error(`不支持的备份版本：${env.version}`)
    deps.storage.importAll({ kv: env.kv, files: env.files })
    return true
  }

  return { backup, restore }
}
