import {
  selectRelevantFriends, extractKeywords, sessionIdFromFileName, parseFile,
} from '@nianlun/core'
import type { Friend, ReportData, ChatQaContext, RawExcerpt } from '@nianlun/core'
import { rawStore as defaultRawStore } from './rawStore'
import { samples as defaultSamples } from './samples'

export interface ChatQaRetrievalDeps {
  rawStore?: { list(): { name: string; size: number }[]; read(name: string): string }
  samples?: { gatherTopSamples(friends: Friend[], opts?: { maxFriends?: number; perFriend?: number; maxTotal?: number }): string[] }
}
export interface RetrieveResult { context: ChatQaContext; rawAvailable: boolean; wantedRaw: boolean }
export interface ChatQaRetrieval {
  retrieve(question: string, friends: Friend[], report: ReportData | null): RetrieveResult
}

const MAX_CHARS_PER_FRIEND = 4000     // 每位好友原文喂给 AI 的字符上限，防爆 token
const MAX_RAW_LINES = 120             // 每位好友最多取的行数

const fmtDate = (ts: number) => (ts ? new Date(ts).toISOString().slice(0, 10) : '')

function buildStatsSummary(friends: Friend[], report: ReportData | null): string {
  if (!report) return ''
  const nameById = new Map(friends.map((f) => [f.id, f.alias || f.name]))
  const top = report.topContacts.slice(0, 5)
    .map((c, i) => `${i + 1}.${nameById.get(c.friendId) ?? c.friendId}（${c.msgCount}条）`).join('，')
  const rel = report.relationBreakdown.filter((r) => r.percent > 0)
    .map((r) => `${r.rel}${r.percent}%`).join('，')
  return [
    `年份${report.year}；好友${report.friendCount}位；全年消息${report.totalMessages}条；活跃${report.activeDays}天。`,
    top ? `聊得最多：${top}。` : '',
    rel ? `关系分布：${rel}。` : '',
  ].filter(Boolean).join('\n')
}

/** 从末尾往前累计，保留最近的行直到字符预算用尽（返回时恢复时间正序）。 */
function capChars(lines: string[], budget: number): string[] {
  const out: string[] = []
  let used = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    used += lines[i].length + 1
    if (used > budget) break
    out.unshift(lines[i])
  }
  return out
}

export function makeChatQaRetrieval(deps: ChatQaRetrievalDeps = {}): ChatQaRetrieval {
  const rawStore = deps.rawStore ?? defaultRawStore
  const samples = deps.samples ?? defaultSamples

  return {
    retrieve(question, friends, report) {
      const statsSummary = buildStatsSummary(friends, report)
      const files = rawStore.list()
      const rawAvailable = files.length > 0
      const ids = selectRelevantFriends(question, friends)
      const wantedRaw = ids.length > 0
      const nameById = new Map(friends.map((f) => [f.id, f.alias || f.name]))
      const rawExcerpts: RawExcerpt[] = []

      if (rawAvailable && wantedRaw) {
        const keywords = extractKeywords(question, ids.map((id) => nameById.get(id) ?? ''))
        for (const id of ids) {
          const fileNames = files
            .filter((f) => sessionIdFromFileName(f.name) === id)
            .map((f) => f.name)
          const lines: string[] = []
          for (const name of fileNames) {
            const content = rawStore.read(name)
            if (!content) continue
            const parsed = parseFile(name, content)      // 原文重解析成可读消息
            for (const conv of parsed.conversations) {
              for (const m of conv.messages) {
                if (m.type !== 'text' || !m.text) continue
                const who = m.from === 'me' ? '我' : (nameById.get(id) ?? '对方')
                lines.push(`${fmtDate(m.ts)} ${who}：${m.text}`)
              }
            }
          }
          if (!lines.length) continue
          const matched = keywords.length ? lines.filter((l) => keywords.some((k) => l.includes(k))) : []
          const picked = (matched.length ? matched : lines).slice(-MAX_RAW_LINES)
          rawExcerpts.push({ friend: nameById.get(id) ?? id, lines: capChars(picked, MAX_CHARS_PER_FRIEND) })
        }
      }

      // 没捞到原文（泛问、或 rawStore 空/无匹配行）→ 退回样本
      const sampleLines = rawExcerpts.length === 0
        ? samples.gatherTopSamples(friends, { maxFriends: 12, perFriend: 5, maxTotal: 80 })
        : []

      return { context: { statsSummary, samples: sampleLines, rawExcerpts }, rawAvailable, wantedRaw }
    },
  }
}

export const chatQaRetrieval: ChatQaRetrieval = makeChatQaRetrieval()
