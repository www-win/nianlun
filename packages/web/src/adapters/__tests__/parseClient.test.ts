import { describe, it, expect, vi } from 'vitest'
import { parseFiles } from '../parseClient'
import type { WorkerLike, ParseRequest, ParseResponse } from '../../worker/protocol'

// A fake worker that echoes scripted responses after receiving a request.
function makeFakeWorker(scripted: ParseResponse[]): WorkerLike {
  const w: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(_msg: unknown) {
      // deliver scripted responses asynchronously
      queueMicrotask(() => { scripted.forEach((r) => w.onmessage && w.onmessage({ data: r })) })
    },
  }
  return w
}

describe('parseFiles', () => {
  it('resolves with the done payload and reports progress', async () => {
    const done: ParseResponse = {
      type: 'done',
      conversations: [],
      friends: [{ id: '周彤' } as any],
      report: { year: 2025, totalMessages: 5 } as any,
      warnings: [],
    }
    const progressSpy = vi.fn()
    const result = await parseFiles(
      [{ name: 'a.txt', content: 'x' }], 2025,
      { onProgress: progressSpy, createWorker: () => makeFakeWorker([{ type: 'progress', value: 0.5 }, done]) },
    )
    expect(progressSpy).toHaveBeenCalledWith(0.5)
    expect(result.friends).toHaveLength(1)
    expect(result.report.totalMessages).toBe(5)
  })

  it('rejects on an error response', async () => {
    await expect(parseFiles(
      [{ name: 'a.txt', content: 'x' }], 2025,
      { createWorker: () => makeFakeWorker([{ type: 'error', message: '解析失败' }]) },
    )).rejects.toThrow('解析失败')
  })
})
