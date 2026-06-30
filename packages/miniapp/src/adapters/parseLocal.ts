import {
  parseFile, aggregate, buildReport, mergeConversations, extractFriendSamples,
} from '@nianlun/core'
import type { Conversation, Friend, ReportData } from '@nianlun/core'

export interface LocalFile { name: string; content: string }

export interface ParseOutcome {
  friends: Friend[]
  report: ReportData
  warnings: string[]
  /** 有界聊天样本（键为 friend id）；绝不持久化原始会话。 */
  samples: Record<string, string[]>
}

export function parseLocal(
  files: LocalFile[],
  year: number,
  onProgress?: (p: number) => void,
): ParseOutcome {
  let conversations: Conversation[] = []
  const warnings: string[] = []
  files.forEach((f, i) => {
    const r = parseFile(f.name, f.content)
    conversations = mergeConversations(conversations, r.conversations)
    r.warnings.forEach((w) => warnings.push(`${f.name}: ${w.reason}`))
    onProgress?.((i + 1) / files.length)
  })
  const friends = aggregate(conversations)
  const report = buildReport(conversations, friends, year)
  const samples = extractFriendSamples(conversations)
  return { friends, report, warnings, samples }
}
