import type { RawFsBackend } from './rawStore'

/** 「JSON 键值」后端：每个 name 对应一份 JSON 数据。容错，read 永不抛。 */
export interface FsJsonBackend {
  read(name: string): unknown
  write(name: string, data: unknown): void
  remove(name: string): void
  /** 读磁盘上的原始 JSON 文本（不解析）；不存在返回 undefined。 */
  readRaw(name: string): string | undefined
  /** 直接把原始 JSON 文本落盘（不再序列化）。 */
  writeRaw(name: string, raw: string): void
}

/** 真机：把每个 name 存成 `${baseDir}/${name}.json`（文件系统，无 1MB/10MB 限制）。 */
export function makeFsJson(fs: RawFsBackend, baseDir: string): FsJsonBackend {
  const path = (name: string) => `${baseDir}/${name}.json`
  return {
    read(name) {
      try { return JSON.parse(fs.readFile(path(name))) } catch { return undefined }
    },
    write(name, data) {
      fs.ensureDir(baseDir)
      // [perf] 诊断插桩：拆分「序列化 / 同步写盘」耗时 + 字节数。排查完删。
      const _t0 = Date.now()
      const json = JSON.stringify(data)
      const _t1 = Date.now()
      fs.writeFile(path(name), json)
      const _t2 = Date.now()
      // eslint-disable-next-line no-console
      console.log(`[perf] fs.write ${name} bytes=${json.length} stringify=${_t1 - _t0}ms writeFile=${_t2 - _t1}ms`)
    },
    remove(name) {
      try { fs.unlink(path(name)) } catch { /* 不存在，忽略 */ }
    },
    readRaw(name) {
      try { return fs.readFile(path(name)) } catch { return undefined }
    },
    writeRaw(name, raw) {
      fs.ensureDir(baseDir)
      fs.writeFile(path(name), raw)
    },
  }
}

interface KvLike { get(k: string): unknown; set(k: string, v: unknown): void; remove(k: string): void }

/** 缺省退化：把 JSON 对象直接存进 KV 键（供测试/无文件系统环境；真机不用它）。 */
export function makeKvFsJson(kv: KvLike): FsJsonBackend {
  const key = (name: string) => `nianlun:fsjson:${name}`
  return {
    read(name) {
      const v = kv.get(key(name))
      return v === '' || v === undefined || v === null ? undefined : v
    },
    write(name, data) { kv.set(key(name), data) },
    remove(name) { kv.remove(key(name)) },
    readRaw(name) {
      const v = kv.get(key(name))
      return v === '' || v === undefined || v === null ? undefined : JSON.stringify(v)
    },
    writeRaw(name, raw) { kv.set(key(name), JSON.parse(raw)) },
  }
}
