import { describe, it, expect } from 'vitest'
import { makeRawStore, type RawFsBackend } from '../rawStore'

// 内存文件系统：路径 → 内容
function memFs(): RawFsBackend {
  const files = new Map<string, string>()
  const dirs = new Set<string>()
  return {
    ensureDir: (d) => { dirs.add(d) },
    writeFile: (p, data) => { files.set(p, data) },
    readFile: (p) => { const v = files.get(p); if (v == null) throw new Error('ENOENT'); return v },
    readdir: (d) => [...files.keys()].filter((p) => p.startsWith(d + '/')).map((p) => p.slice(d.length + 1)),
    size: (p) => (files.get(p) ?? '').length,
    unlink: (p) => { files.delete(p) },
    exists: (p) => files.has(p) || dirs.has(p),
  }
}

const DIR = '/raw'

describe('rawStore 基础存取', () => {
  it('写入后 count/list/read/readAll 一致', () => {
    const s = makeRawStore(memFs(), DIR)
    s.write([{ name: 'a.jsonl', content: 'AAA' }, { name: 'b.jsonl', content: 'BBB' }])
    expect(s.count()).toBe(2)
    expect(s.list()).toEqual([{ name: 'a.jsonl', size: 3 }, { name: 'b.jsonl', size: 3 }])
    expect(s.read('a.jsonl')).toBe('AAA')
    expect(s.readAll()).toEqual([{ name: 'a.jsonl', content: 'AAA' }, { name: 'b.jsonl', content: 'BBB' }])
  })

  it('同名覆盖：重复写同名文件只留最新一份', () => {
    const s = makeRawStore(memFs(), DIR)
    s.write([{ name: 'a.jsonl', content: 'v1' }])
    s.write([{ name: 'a.jsonl', content: 'v2' }])
    expect(s.count()).toBe(1)
    expect(s.read('a.jsonl')).toBe('v2')
  })

  it('分片不同名各存一份，不互相覆盖', () => {
    const s = makeRawStore(memFs(), DIR)
    s.write([
      { name: 'g@chatroom_00000000.jsonl', content: 'p0' },
      { name: 'g@chatroom_00000001.jsonl', content: 'p1' },
    ])
    expect(s.count()).toBe(2)
  })

  it('文件名带路径分隔符被清洗，不越目录', () => {
    const s = makeRawStore(memFs(), DIR)
    s.write([{ name: '../evil.jsonl', content: 'x' }])
    expect(s.list()[0].name).not.toContain('/')
    expect(s.list()[0].name).not.toContain('..')
  })

  it('空目录时 count=0、list/readAll 为空、read 缺失返回空串', () => {
    const s = makeRawStore(memFs(), DIR)
    expect(s.count()).toBe(0)
    expect(s.list()).toEqual([])
    expect(s.readAll()).toEqual([])
    expect(s.read('nope.jsonl')).toBe('')
  })

  it('clear 删空目录内全部文件', () => {
    const s = makeRawStore(memFs(), DIR)
    s.write([{ name: 'a.jsonl', content: 'A' }, { name: 'b.jsonl', content: 'B' }])
    s.clear()
    expect(s.count()).toBe(0)
  })
})
