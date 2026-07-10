import {
  parseFile, aggregate, buildReport, mergeConversations, extractFriendSamples,
} from '@nianlun/core'
import type { Conversation, Friend, ReportData } from '@nianlun/core'

/** 好友详情页「最近一个月」用到的近期数据（键为 friend id）。 */
export type RecentInsight = Pick<Friend, 'keywords' | 'weekHour'>

/** 「最近一个月」窗口天数：以数据中最新一条消息为基准往前推。 */
export const RECENT_DAYS = 30

export interface LocalFile { name: string; content: string }

/** miniapp 侧样本留存参数：比 core 默认(30/80)更大，供 AI 分析与问答 agent。 */
const SAMPLE_OPTS = { maxPerFriend: 60, maxChars: 120 }

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
  return { recentInsights, recentSamples: extractFriendSamples(recentConvs, SAMPLE_OPTS) }
}

/** parseLocal 进度阶段：解析逐文件推进 / 聚合建报告（单次同步、无子进度）。 */
export type ParsePhase = 'parsing' | 'aggregating'
export interface ParseProgress { phase: ParsePhase; done: number; total: number }

/** 让渲染线程刷新一拍：中间进度必须靠宏任务让渡才能被 setData 刷出来（微信双线程）。 */
const tick = () => new Promise<void>((r) => setTimeout(r, 0))
/** 每解析这么多文件让渡一次渲染线程，兼顾"进度可见"与"让渡开销"。 */
const YIELD_EVERY = 20

export async function parseLocal(
  files: LocalFile[],
  year: number,
  onProgress?: (p: ParseProgress) => void,
): Promise<ParseOutcome> {
  let conversations: Conversation[] = []
  const warnings: string[] = []
  const total = files.length
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const r = parseFile(f.name, f.content)
    conversations = mergeConversations(conversations, r.conversations)
    r.warnings.forEach((w) => warnings.push(`${f.name}: ${w.reason}`))
    onProgress?.({ phase: 'parsing', done: i + 1, total })
    if ((i + 1) % YIELD_EVERY === 0) await tick()   // 让渲染线程刷出中间百分比
  }
  // 聚合前先报阶段并让一拍："生成报告"文案与动画条得以先渲染，再跑同步聚合
  onProgress?.({ phase: 'aggregating', done: 0, total: 1 })
  await tick()
  const friends = aggregate(conversations)
  const report = buildReport(conversations, friends, year)
  const samples = extractFriendSamples(conversations, SAMPLE_OPTS)
  const { recentInsights, recentSamples } = computeRecentInsights(conversations)
  return { friends, report, warnings, samples, recentInsights, recentSamples }
}
