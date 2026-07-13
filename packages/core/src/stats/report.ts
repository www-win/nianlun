import type { Conversation, Friend, ReportData, Relation } from '../model/types'
import { mergeKeywords } from './global'

/**
 * 纯从好友列表派生的报告字段（排名榜 + 关系分布）。不依赖原始会话，
 * 因此多批次导入后可用「全量好友」重算，让概览与好友列表口径一致。
 */
export function friendReportFields(
  friends: Friend[],
): Pick<ReportData, 'topContacts' | 'relationBreakdown'> {
  const topContacts = [...friends]
    .sort((a, b) => b.msgCount - a.msgCount)
    .slice(0, 3)
    .map((f) => ({ friendId: f.id, msgCount: f.msgCount }))

  const byRel = new Map<Relation, number>()
  friends.forEach((f) => byRel.set(f.rel, (byRel.get(f.rel) ?? 0) + f.msgCount))
  const relTotal = [...byRel.values()].reduce((a, b) => a + b, 0) || 1
  const relationBreakdown = [...byRel.entries()].map(([rel, n]) => ({
    rel,
    percent: Math.round((n / relTotal) * 100),
  }))

  return { topContacts, relationBreakdown }
}

export function buildReport(
  conversations: Conversation[],
  friends: Friend[],
  year: number,
): ReportData {
  const days = new Set<string>()
  let total = 0
  let latest: { ts: number; friendId: string } | null = null

  conversations.forEach((c) => {
    c.messages.forEach((m) => {
      total++
      if (m.ts) {
        days.add(new Date(m.ts).toISOString().slice(0, 10))
        if (!latest || m.ts > latest.ts) latest = { ts: m.ts, friendId: c.id }
      }
    })
  })

  return {
    year,
    totalMessages: total,
    friendCount: friends.length,
    activeDays: days.size,
    latestMessage: latest,
    keywords: mergeKeywords(friends, 50),
    ...friendReportFields(friends),
  }
}
