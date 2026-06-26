import type { Friend, ReportData } from '@nianlun/core'
import type { WorkerLike, ParseRequest, ParseResponse } from '../worker/protocol'

export interface ParseOutcome {
  friends: Friend[]
  report: ReportData
  warnings: string[]
  /** 有界的聊天样本（键为 friend id）；仅存内存，绝不持久化。 */
  samples: Record<string, string[]>
}

export interface ParseOptions {
  onProgress?: (p: number) => void
  createWorker?: () => WorkerLike
}

function defaultWorker(): WorkerLike {
  return new Worker(new URL('../worker/parse.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike
}

export function parseFiles(
  files: { name: string; content: string }[],
  year: number,
  opts: ParseOptions = {},
): Promise<ParseOutcome> {
  const worker = (opts.createWorker ?? defaultWorker)()
  return new Promise<ParseOutcome>((resolve, reject) => {
    worker.onmessage = (ev) => {
      const msg: ParseResponse = ev.data
      if (msg.type === 'progress') opts.onProgress?.(msg.value)
      else if (msg.type === 'done') {
        worker.terminate?.()
        resolve({ friends: msg.friends, report: msg.report, warnings: msg.warnings, samples: msg.samples })
      } else if (msg.type === 'error') {
        worker.terminate?.()
        reject(new Error(msg.message))
      }
    }
    worker.onerror = (e) => { worker.terminate?.(); reject(new Error('Worker 运行出错')) }
    const req: ParseRequest = { files, year }
    worker.postMessage(req)
  })
}
