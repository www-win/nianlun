import { describe, it, expect, vi } from 'vitest'
import { makeFileReader } from '../fileReader'

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
