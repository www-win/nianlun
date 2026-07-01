import {
  parseFile, aggregate, buildReport, mergeConversations, extractFriendSamples,
} from '@nianlun/core'
import type { Conversation, Friend, ReportData } from '@nianlun/core'

/** 好友详情页「最近一个月」用到的近期数据（键为 friend id）。 */
export type RecentInsight = Pick<Friend, 'keywords' | 'weekHour'>

/** 「最近一个月」窗口天数：以数据中最新一条消息为基准往前推。 */
export const RECENT_DAYS = 30

export interface LocalFile { name: string; content: string }

export interface ParseOutcome {
  friends: Friend[]
  report: ReportData
  warnings: string[]
  /** 有界聊天样本（键为 friend id）；绝不持久化原始会话。 */
  samples: Record<string, string[]>
  /** 好友详情页专用：最近一个月的高频词 + 活跃时段（键为 friend id）。 */
  recentInsights: Record<string, RecentInsight>
  /** 好友详情页专用：最近一个月的聊天样本（键为 friend id）。 */
  recentSamples: Record<string, string[]>
}

/**
 * 计算「最近一个月」的高频词 / 活跃时段 / 聊天样本，仅供好友详情页显示。
 * 纯函数：以全体消息里最新一条的时间戳为基准，保留 [maxTs − RECENT_DAYS 天, maxTs]
 * 窗口内的消息，复用 core 的 aggregate/extractFriendSamples 重算。窗口内无消息的好友被排除。
 */
export function computeRecentInsights(conversations: Conversation[]): {
  recentInsights: Record<string, RecentInsight>
  recentSamples: Record<string, string[]>
} {
  let maxTs = 0
  for (const c of conversations) {
    for (const m of c.messages) if (m.ts > maxTs) maxTs = m.ts
  }
  if (!maxTs) return { recentInsights: {}, recentSamples: {} }

  const since = maxTs - RECENT_DAYS * 86400000
  const recentConvs = conversations
    .map((c) => ({ ...c, messages: c.messages.filter((m) => m.ts >= since) }))
    .filter((c) => c.messages.length > 0)

  const recentInsights: Record<string, RecentInsight> = {}
  for (const f of aggregate(recentConvs)) {
    recentInsights[f.id] = { keywords: f.keywords, weekHour: f.weekHour }
  }
  return { recentInsights, recentSamples: extractFriendSamples(recentConvs) }
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
  const { recentInsights, recentSamples } = computeRecentInsights(conversations)
  return { friends, report, warnings, samples, recentInsights, recentSamples }
}
