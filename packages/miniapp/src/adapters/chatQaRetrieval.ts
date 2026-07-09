import {
  selectRelevantFriends, extractKeywords, sessionIdFromFileName, parseFile,
} from '@nianlun/core'
import type { Friend, ReportData, ChatQaContext, RawExcerpt } from '@nianlun/core'
import { rawStore as defaultRawStore } from './rawStore'
import { samples as defaultSamples } from './samples'

export interface ChatQaRetrievalDeps {
  rawStore?: { list(): { name: string; size: number }[]; read(name: string): string }
  samples?: {
    gatherTopSamples(friends: Friend[], opts?: { maxFriends?: number; perFriend?: number; maxTotal?: number }): string[]
    loadSamplesFor(id: string): string[]
  }
}
export interface RetrieveResult {
  context: ChatQaContext
  wantedRaw: boolean          // 问题里点名了 ≥1 位好友（含被后续剔除的群聊）
  gotNamedMaterial: boolean   // 对点名好友，是否取到任何专属素材（原文或该好友样本）
}
export interface ChatQaRetrieval {
  retrieve(question: string, friends: Friend[], report: ReportData | null): RetrieveResult
}

const MAX_CHARS_PER_FRIEND = 4000     // 每位好友原文喂给 AI 的字符上限，防爆 token
const MAX_RAW_LINES = 120             // 每位好友最多取的行数
const MAX_NAMED_FRIENDS = 3           // 单轮最多处理的点名好友数，防命中一大批好友时 prompt 失控
const PER_FRIEND_SAMPLE_LINES = 20    // 无原文时退回该好友专属样本的行数上限

const fmtDate = (ts: number) => (ts ? new Date(ts).toISOString().slice(0, 10) : '')

const isGroupSession = (id: string) => id.endsWith('@chatroom')

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
      const nameById = new Map(friends.map((f) => [f.id, f.alias || f.name]))
      const files = rawStore.list()

      // 群聊暂不逐发言人归因（会把群里多人的话贴成一个人），故从点名结果里剔除，避免张冠李戴。
      const allNamed = selectRelevantFriends(question, friends)
      const wantedRaw = allNamed.length > 0
      const namedIds = allNamed.filter((id) => !isGroupSession(id)).slice(0, MAX_NAMED_FRIENDS)

      const rawExcerpts: RawExcerpt[] = []
      let gotNamedMaterial = false

      for (const id of namedIds) {
        const friendName = nameById.get(id) ?? id
        // 1) 原文：跨该好友所有原文件汇总，按时间排序去重后取最近若干行
        const fileNames = files
          .filter((f) => sessionIdFromFileName(f.name) === id)
          .map((f) => f.name)
        const msgs: { ts: number; from: 'me' | 'them'; text: string }[] = []
        for (const name of fileNames) {
          const content = rawStore.read(name)
          if (!content) continue
          const parsed = parseFile(name, content)      // 原文重解析成可读消息
          for (const conv of parsed.conversations) {
            for (const m of conv.messages) {
              if (m.type !== 'text' || !m.text) continue
              msgs.push({ ts: m.ts, from: m.from, text: m.text })
            }
          }
        }
        if (msgs.length) {
          msgs.sort((a, b) => a.ts - b.ts)             // 跨文件按时间排序
          const seen = new Set<string>()
          const lines: string[] = []
          for (const m of msgs) {
            const key = `${m.ts}|${m.from}|${m.text}`
            if (seen.has(key)) continue                // 跨文件重叠去重
            seen.add(key)
            const who = m.from === 'me' ? '我' : friendName
            lines.push(`${fmtDate(m.ts)} ${who}：${m.text}`)
          }
          const keywords = extractKeywords(question, [friendName])
          const matched = keywords.length ? lines.filter((l) => keywords.some((k) => l.includes(k))) : []
          const picked = (matched.length ? matched : lines).slice(-MAX_RAW_LINES)
          rawExcerpts.push({ friend: friendName, lines: capChars(picked, MAX_CHARS_PER_FRIEND) })
          gotNamedMaterial = true
          continue
        }
        // 2) 无原文 → 退回该好友专属样本（署名正确，不会张冠李戴）
        const own = samples.loadSamplesFor(id)
        if (own.length) {
          rawExcerpts.push({ friend: friendName, lines: own.slice(0, PER_FRIEND_SAMPLE_LINES) })
          gotNamedMaterial = true
        }
      }

      // 泛问（未点名任何好友）才用全局高频样本；点名场景只用该好友专属素材，避免混入别人的话。
      const sampleLines = wantedRaw
        ? []
        : samples.gatherTopSamples(friends, { maxFriends: 12, perFriend: 5, maxTotal: 80 })

      return { context: { statsSummary, samples: sampleLines, rawExcerpts }, wantedRaw, gotNamedMaterial }
    },
  }
}

export const chatQaRetrieval: ChatQaRetrieval = makeChatQaRetrieval()
