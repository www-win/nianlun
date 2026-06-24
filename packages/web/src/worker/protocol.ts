import type { Conversation, Friend, ReportData } from '@nianlun/core'

export interface ParseRequest {
  files: { name: string; content: string }[]
  year: number
}

export type ParseResponse =
  | { type: 'progress'; value: number }
  | { type: 'done'; conversations: Conversation[]; friends: Friend[]; report: ReportData; warnings: string[] }
  | { type: 'error'; message: string }

export interface WorkerLike {
  postMessage(msg: unknown): void
  onmessage: ((ev: { data: ParseResponse }) => void) | null
  onerror: ((ev: unknown) => void) | null
  terminate?(): void
}
