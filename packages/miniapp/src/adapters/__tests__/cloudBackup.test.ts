import { describe, it, expect, vi } from 'vitest'
import { gzipSync, gunzipSync } from 'fflate'
import { makeCloudBackup } from '../cloudBackup'
import type { StorageSnapshot } from '../storage'

function memStorage(initial: StorageSnapshot) {
  let snap = initial
  let merged: StorageSnapshot | null = null
  return {
    exportAll: () => snap,
    importAll: (s: StorageSnapshot) => { snap = s },
    mergeAiResults: (s: StorageSnapshot) => { merged = s },
    _get: () => snap,
    _merged: () => merged,
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

  it('restoreMerge：取回云端快照后调 mergeAiResults（不覆盖，交给 storage 合并）', async () => {
    const src = memStorage({ kv: { 'nianlun:analyzedIds': ['a'] }, files: { friendSentiment: '{"a":{"data":{"tone":"暖"},"fp":"1:1"}}' } })
    const cloud = memCloud()
    await makeCloudBackup(deps(src, cloud)).backup()

    const dst = memStorage({ kv: {}, files: {} })
    const cb = makeCloudBackup(deps(dst, cloud))
    const ok = await cb.restoreMerge()
    expect(ok).toBe(true)
    expect(dst._merged()).toEqual({ kv: { 'nianlun:analyzedIds': ['a'] }, files: { friendSentiment: '{"a":{"data":{"tone":"暖"},"fp":"1:1"}}' } })
  })

  it('restoreMerge：云端无备份返回 false、不调 mergeAiResults', async () => {
    const dst = memStorage({ kv: {}, files: {} })
    const cb = makeCloudBackup(deps(dst, memCloud()))
    expect(await cb.restoreMerge()).toBe(false)
    expect(dst._merged()).toBeNull()
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

describe('cloudBackup 合并到云端（只增不减，不破坏云端数据）', () => {
  it('本机缺 report 时再次备份，不会把云端已有的 report 冲掉；好友更新为最新', async () => {
    const cloud = memCloud()
    // 第一次：本机有 report + 好友，备份到云
    await makeCloudBackup(deps(memStorage({ kv: { 'nianlun:report': { year: 2025 } }, files: { friends: '[1]' } }), cloud)).backup()
    // 第二次：模拟换机后只恢复了好友、report 还没回来，此时触发自动备份
    await makeCloudBackup(deps(memStorage({ kv: {}, files: { friends: '[1,2]' } }), cloud)).backup()

    const dst = memStorage({ kv: {}, files: {} })
    const ok = await makeCloudBackup(deps(dst, cloud)).restore()
    expect(ok).toBe(true)
    expect(dst._get().kv['nianlun:report']).toEqual({ year: 2025 })   // 云端 report 未被冲掉
    expect(dst._get().files.friends).toBe('[1,2]')                    // 好友更新为最新
  })

  it('读云端失败时 backup 抛错中止、绝不上传（云端文件保持不变）', async () => {
    const cloud = memCloud()
    await makeCloudBackup(deps(memStorage({ kv: { 'nianlun:report': { y: 1 } }, files: { friends: '[1]' } }), cloud)).backup()
    const before = [...cloud._files.keys()].sort()

    // 云端 download 抛错（网络等），upload 仍指向同一份内存云
    const errCloud = { upload: cloud.upload, download: async () => { throw new Error('net down') } }
    await expect(
      makeCloudBackup(deps(memStorage({ kv: {}, files: { friends: '[]' } }), errCloud)).backup(),
    ).rejects.toThrow()
    expect([...cloud._files.keys()].sort()).toEqual(before)   // 云端未被改动
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

describe('cloudBackup mode 标记', () => {
  it('单包备份成功后 finalize 以 single 调用一次', async () => {
    const src = memStorage({ kv: {}, files: { friends: '[]' } })
    const cloud = memCloud()
    const finalize = vi.fn(async () => {})
    await makeCloudBackup({ ...deps(src, cloud), finalize }, { bigThreshold: 8 * 1024 * 1024 }).backup()
    expect(finalize).toHaveBeenCalledTimes(1)
    expect(finalize).toHaveBeenCalledWith('single')
  })

  it('分块备份成功后 finalize 以 chunked 调用一次', async () => {
    const big = 'x'.repeat(50)
    const src = memStorage({ kv: {}, files: { friends: `["${big}"]` } })
    const cloud = memCloud()
    const finalize = vi.fn(async () => {})
    await makeCloudBackup({ ...deps(src, cloud), finalize }, { bigThreshold: 10 }).backup()
    expect(finalize).toHaveBeenCalledTimes(1)
    expect(finalize).toHaveBeenCalledWith('chunked')
  })

  it('resolveMode 返回 chunked 时 restore 只走 manifest 路径（即便还放了同名单包也不用）', async () => {
    const big = 'x'.repeat(50)
    const src = memStorage({ kv: { 'nianlun:report': { note: big } }, files: { friends: `["${big}"]` } })
    const cloud = memCloud()
    // 只放 manifest + parts，不放单包，模拟真实的分块态；resolveMode 直接指路
    await makeCloudBackup(deps(src, cloud), { bigThreshold: 10 }).backup()
    expect([...cloud._files.keys()]).not.toContain('backup.json.gz')

    const dst = memStorage({ kv: {}, files: {} })
    const resolveMode = vi.fn(async () => 'chunked' as const)
    const ok = await makeCloudBackup({ ...deps(dst, cloud), resolveMode }, { bigThreshold: 10 }).restore()
    expect(ok).toBe(true)
    expect(resolveMode).toHaveBeenCalledTimes(1)
    expect(dst._get()).toEqual(src._get())
  })

  it('resolveMode 返回 single 时 restore 只走单包路径', async () => {
    const src = memStorage({ kv: { 'nianlun:report': { year: 2025 } }, files: { friends: '[{"id":"a"}]' } })
    const cloud = memCloud()
    await makeCloudBackup(deps(src, cloud)).backup()
    expect([...cloud._files.keys()]).toEqual(['backup.json.gz'])

    const dst = memStorage({ kv: {}, files: {} })
    const resolveMode = vi.fn(async () => 'single' as const)
    const ok = await makeCloudBackup({ ...deps(dst, cloud), resolveMode }).restore()
    expect(ok).toBe(true)
    expect(dst._get()).toEqual(src._get())
  })
})
