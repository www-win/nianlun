import { describe, it, expect } from 'vitest'
import { makeFsJson, makeKvFsJson } from '../fsStore'
import type { RawFsBackend } from '../rawStore'

/** 内存版 RawFsBackend：用 Map 当文件系统。 */
function memFs(): RawFsBackend {
  const files = new Map<string, string>()
  return {
    ensureDir: () => {},
    writeFile: (p, data) => { files.set(p, data) },
    readFile: (p) => { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p)! },
    readdir: () => [...files.keys()],
    size: (p) => (files.get(p)?.length ?? 0),
    unlink: (p) => { files.delete(p) },
  }
}

describe('makeFsJson', () => {
  it('write/read 往返（对象按 name 存成 .json 文件）', () => {
    const j = makeFsJson(memFs(), '/base')
    j.write('friends', [{ id: 'a' }, { id: 'b' }])
    expect(j.read('friends')).toEqual([{ id: 'a' }, { id: 'b' }])
  })
  it('文件不存在 → undefined（不抛）', () => {
    expect(makeFsJson(memFs(), '/base').read('nope')).toBeUndefined()
  })
  it('坏 JSON → undefined（不抛）', () => {
    const fs = memFs()
    fs.writeFile('/base/x.json', '{坏json')
    expect(makeFsJson(fs, '/base').read('x')).toBeUndefined()
  })
  it('remove 后 read → undefined', () => {
    const j = makeFsJson(memFs(), '/base')
    j.write('s', { a: 1 }); j.remove('s')
    expect(j.read('s')).toBeUndefined()
  })
})

describe('makeKvFsJson（缺省退化到 KV）', () => {
  it('write/read 往返，存进 nianlun:fsjson:<name> 键', () => {
    const m = new Map<string, unknown>()
    const kv = { get: (k: string) => m.get(k), set: (k: string, v: unknown) => void m.set(k, v), remove: (k: string) => void m.delete(k) }
    const j = makeKvFsJson(kv)
    j.write('friends', [{ id: 'a' }])
    expect(j.read('friends')).toEqual([{ id: 'a' }])
    expect(m.has('nianlun:fsjson:friends')).toBe(true)
  })
  it('缺失 → undefined（含 wx 空串语义）', () => {
    const kv = { get: () => '', set: () => {}, remove: () => {} }
    expect(makeKvFsJson(kv).read('x')).toBeUndefined()
  })
})
