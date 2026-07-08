import { describe, it, expect } from 'vitest'
import { gzipSync, gunzipSync } from 'fflate'
import { makeCloudBackup } from '../cloudBackup'
import type { StorageSnapshot } from '../storage'

function memStorage(initial: StorageSnapshot) {
  let snap = initial
  return {
    exportAll: () => snap,
    importAll: (s: StorageSnapshot) => { snap = s },
    _get: () => snap,
  }
}
/** 内存云：按 cloudPath 存字节。 */
function memCloud() {
  const files = new Map<string, Uint8Array>()
  return {
    upload: async (p: string, bytes: Uint8Array) => void files.set(p, bytes),
    download: async (p: string) => (files.has(p) ? files.get(p)! : null),
    _files: files,
  }
}

const deps = (storage: any, cloud: any) => ({
  storage, upload: cloud.upload, download: cloud.download,
  gzip: (d: Uint8Array) => gzipSync(d, { level: 4 }), gunzip: gunzipSync,
  now: () => 1_700_000_000_000,
})

describe('cloudBackup 单包', () => {
  it('backup 后 restore 到另一个 storage，数据等价', async () => {
    const src = memStorage({ kv: { 'nianlun:report': { year: 2025 } }, files: { friends: '[{"id":"a"}]' } })
    const cloud = memCloud()
    const cbSrc = makeCloudBackup(deps(src, cloud))
    const res = await cbSrc.backup()
    expect(res.bytes).toBeGreaterThan(0)

    const dst = memStorage({ kv: {}, files: {} })
    const cbDst = makeCloudBackup(deps(dst, cloud))
    const ok = await cbDst.restore()
    expect(ok).toBe(true)
    expect(dst._get()).toEqual({ kv: { 'nianlun:report': { year: 2025 } }, files: { friends: '[{"id":"a"}]' } })
  })

  it('云端无备份时 restore 返回 false', async () => {
    const dst = memStorage({ kv: {}, files: {} })
    const cb = makeCloudBackup(deps(dst, memCloud()))
    expect(await cb.restore()).toBe(false)
  })

  it('上传的确实是 gzip 压缩后的字节（能被 gunzip 还原成含 version 的信封）', async () => {
    const src = memStorage({ kv: {}, files: { friends: '[]' } })
    const cloud = memCloud()
    await makeCloudBackup(deps(src, cloud)).backup()
    const bytes = [...cloud._files.values()][0]
    const json = new TextDecoder().decode(gunzipSync(bytes))
    const env = JSON.parse(json)
    expect(env.version).toBe(1)
    expect(env.files.friends).toBe('[]')
  })
})

describe('cloudBackup 分块降级', () => {
  it('超阈值时分块上传，restore 能还原', async () => {
    const big = 'x'.repeat(50) // 配合极小阈值触发分块
    const src = memStorage({ kv: { 'nianlun:report': { note: big } }, files: { friends: `["${big}"]`, stocks: '[1,2,3]' } })
    const cloud = memCloud()
    const cb = makeCloudBackup(deps(src, cloud), { bigThreshold: 10 })
    await cb.backup()
    // 应写入 manifest + 多个 part，而非单一 backup.json.gz
    const paths = [...cloud._files.keys()]
    expect(paths).toContain('manifest.json.gz')
    expect(paths.some((p) => p.startsWith('parts/'))).toBe(true)
    expect(paths).not.toContain('backup.json.gz')

    const dst = memStorage({ kv: {}, files: {} })
    const ok = await makeCloudBackup(deps(dst, cloud), { bigThreshold: 10 }).restore()
    expect(ok).toBe(true)
    expect(dst._get()).toEqual(src._get())
  })

  it('阈值内仍走单包', async () => {
    const src = memStorage({ kv: {}, files: { friends: '[]' } })
    const cloud = memCloud()
    await makeCloudBackup(deps(src, cloud), { bigThreshold: 8 * 1024 * 1024 }).backup()
    expect([...cloud._files.keys()]).toEqual(['backup.json.gz'])
  })
})
