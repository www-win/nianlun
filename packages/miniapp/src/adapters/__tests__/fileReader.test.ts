import { describe, it, expect, vi } from 'vitest'
import { makeFileReader, purgeUnzipTemp, removeDirDeep } from '../fileReader'

describe('fileReader 适配器', () => {
  it('选中文件后逐个读出内容', async () => {
    const io = {
      choose: vi.fn().mockResolvedValue([{ path: '/a', name: 'a.txt' }, { path: '/b', name: 'b.txt' }]),
      read: vi.fn(async (p: string) => (p === '/a' ? 'AAA' : 'BBB')),
      unzip: vi.fn(),
    }
    const fr = makeFileReader(io)
    const out = await fr.pickAndRead(2)
    expect(out).toEqual([{ name: 'a.txt', content: 'AAA' }, { name: 'b.txt', content: 'BBB' }])
    expect(io.choose).toHaveBeenCalledWith(2)
  })

  it('未选文件返回空数组', async () => {
    const io = { choose: vi.fn().mockResolvedValue([]), read: vi.fn(), unzip: vi.fn() }
    const out = await makeFileReader(io).pickAndRead()
    expect(out).toEqual([])
    expect(io.read).not.toHaveBeenCalled()
  })

  it('选中 zip 时解压并展开其中的文本文件', async () => {
    const io = {
      choose: vi.fn().mockResolvedValue([{ path: '/z', name: 'export.zip' }]),
      read: vi.fn(),
      unzip: vi.fn().mockResolvedValue([
        { name: 'a.csv', content: 'AAA' },
        { name: 'contacts.json', content: '[]' },
      ]),
    }
    const out = await makeFileReader(io).pickAndRead()
    expect(io.unzip).toHaveBeenCalledWith('/z')
    expect(io.read).not.toHaveBeenCalled()
    expect(out).toEqual([
      { name: 'a.csv', content: 'AAA' },
      { name: 'contacts.json', content: '[]' },
    ])
  })

  it('选到 rar 等非 zip 压缩包时报明确错误', async () => {
    const io = {
      choose: vi.fn().mockResolvedValue([{ path: '/r', name: 'exports.rar' }]),
      read: vi.fn(),
      unzip: vi.fn(),
    }
    await expect(makeFileReader(io).pickAndRead()).rejects.toThrow(/只能解压 ZIP/)
    expect(io.unzip).not.toHaveBeenCalled()
  })

  it('zip 与普通文件混选时都能读出', async () => {
    const io = {
      choose: vi.fn().mockResolvedValue([
        { path: '/z', name: 'pack.zip' },
        { path: '/t', name: 'chat.txt' },
      ]),
      read: vi.fn(async () => 'TXT'),
      unzip: vi.fn(async () => [{ name: 'in.csv', content: 'CSV' }]),
    }
    const out = await makeFileReader(io).pickAndRead()
    expect(out).toEqual([
      { name: 'in.csv', content: 'CSV' },
      { name: 'chat.txt', content: 'TXT' },
    ])
  })
})

// 内存目录树 fs：按路径前缀模拟目录/文件，支持递归删除测试。
function memDirFs() {
  const files = new Set<string>()
  const dirs = new Set<string>()
  const fs = {
    readdirSync: (dir: string) => {
      const prefix = dir + '/'
      const names = new Set<string>()
      for (const p of [...files, ...dirs]) {
        if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split('/')[0])
      }
      if (names.size === 0 && !dirs.has(dir)) throw new Error('ENOENT') // 目录不存在
      return [...names]
    },
    statSync: (p: string) => ({ isDirectory: () => dirs.has(p) }),
    unlinkSync: (p: string) => { files.delete(p) },
    rmdirSync: (p: string) => { dirs.delete(p) },
  }
  return {
    fs,
    addFile: (p: string) => { files.add(p) },
    addDir: (p: string) => { dirs.add(p) },
    has: (p: string) => files.has(p) || dirs.has(p),
  }
}

describe('removeDirDeep', () => {
  it('逐层删除目录树（含子目录与文件）', () => {
    const m = memDirFs()
    m.addDir('/t'); m.addDir('/t/sub'); m.addFile('/t/sub/x'); m.addFile('/t/y')
    removeDirDeep(m.fs, '/t')
    expect(m.has('/t')).toBe(false)
    expect(m.has('/t/sub/x')).toBe(false)
    expect(m.has('/t/y')).toBe(false)
  })

  it('目录不存在时不抛', () => {
    const m = memDirFs()
    expect(() => removeDirDeep(m.fs, '/nope')).not.toThrow()
  })
})

describe('purgeUnzipTemp', () => {
  it('递归删除所有 nianlun_unzip_* 目录树（含子目录），保留其它', () => {
    const m = memDirFs()
    m.addDir('/data/nianlun_unzip_1'); m.addDir('/data/nianlun_unzip_1/batch_01')
    m.addFile('/data/nianlun_unzip_1/batch_01/a.jsonl')
    m.addDir('/data/nianlun_unzip_2'); m.addFile('/data/nianlun_unzip_2/b.jsonl')
    m.addDir('/data/nianlun_raw'); m.addFile('/data/nianlun_raw/keep.jsonl')
    expect(purgeUnzipTemp(m.fs, '/data')).toBe(2)
    expect(m.has('/data/nianlun_unzip_1')).toBe(false)
    expect(m.has('/data/nianlun_unzip_1/batch_01/a.jsonl')).toBe(false)
    expect(m.has('/data/nianlun_unzip_2/b.jsonl')).toBe(false)
    expect(m.has('/data/nianlun_raw/keep.jsonl')).toBe(true) // 非 unzip 目录保留
  })

  it('baseDir 读不到时返回 0、不抛', () => {
    const m = memDirFs()
    expect(purgeUnzipTemp(m.fs, '/empty')).toBe(0)
  })
})
