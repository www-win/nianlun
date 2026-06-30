import { describe, it, expect, vi } from 'vitest'
import { makeFileReader } from '../fileReader'

describe('fileReader 适配器', () => {
  it('选中文件后逐个读出内容', async () => {
    const io = {
      choose: vi.fn().mockResolvedValue([{ path: '/a', name: 'a.txt' }, { path: '/b', name: 'b.txt' }]),
      read: vi.fn(async (p: string) => (p === '/a' ? 'AAA' : 'BBB')),
    }
    const fr = makeFileReader(io)
    const out = await fr.pickAndRead(2)
    expect(out).toEqual([{ name: 'a.txt', content: 'AAA' }, { name: 'b.txt', content: 'BBB' }])
    expect(io.choose).toHaveBeenCalledWith(2)
  })

  it('未选文件返回空数组', async () => {
    const io = { choose: vi.fn().mockResolvedValue([]), read: vi.fn() }
    const out = await makeFileReader(io).pickAndRead()
    expect(out).toEqual([])
    expect(io.read).not.toHaveBeenCalled()
  })
})
