import type { Friend, ReportData } from '../model/types'

export interface Sentiment { tone?: string; summary?: string }

/**
 * 单个好友的情绪分析提示词：依据聚合统计 + 有界样本，要求 AI 输出严格 JSON。
 * tone 为一个具体、生动的情绪基调短词（鼓励多样，非固定档位）。
 */
export function buildFriendSentimentPrompt(friend: Friend, samples: string[]): string {
  const displayName = friend.alias || friend.name
  const sampleBlock = samples.length
    ? samples.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '（本次无可用聊天样本）'

  return [
    '你是一位擅长体察人际情绪的观察者。请根据下面这位微信好友的往来统计与部分聊天样本，',
    '判断你们这一年相处的「情绪基调」。',
    '',
    '只输出一个严格的 JSON 对象，不要任何解释、不要代码围栏外的文字。格式：',
    '{"tone": "<一个具体、生动的情绪基调短词，鼓励多样，例如 热络 / 暧昧 / 渐远 / 客套 / 无话不谈 / 相互扶持 等>", "summary": "<一句话说明依据，20~40 字>"}',
    '',
    '聚合统计：',
    `- 好友：${displayName}`,
    `- 关系标签：${friend.rel}`,
    `- 职务/备注：${friend.role || '（未填）'}`,
    `- 全年消息往来：${friend.msgCount} 条`,
    `- 我方发送占比：${friend.sentRatio}%`,
    `- 活跃时段：${friend.peakPeriod || '（无）'}`,
    '',
    '部分聊天样本（「我」为用户本人，「对方」为该好友）：',
    sampleBlock,
  ].join('\n')
}

/**
 * 全年整体社交情绪提示词：依据年度聚合 + 跨好友样本，写一段中文描述。
 */
export function buildYearSentimentPrompt(report: ReportData, sampleLines: string[]): string {
  const block = sampleLines.length
    ? sampleLines.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '（无可用样本）'

  return [
    '你是一位温暖细腻的观察者。请根据下面这一年的社交统计与若干聊天样本，',
    '写一段 80~150 字、有温度的中文，描述这位用户这一年整体的社交情绪基调',
    '（比如热络还是清淡、以正向还是消耗为主、有哪些情绪起伏）。',
    '只输出这段正文，不要标题、不要解释、不要罗列数字。',
    '',
    '年度统计：',
    `- 年份：${report.year}`,
    `- 全年消息总数：${report.totalMessages}`,
    `- 联系的好友数：${report.friendCount}`,
    `- 活跃聊天天数：${report.activeDays}`,
    '',
    '跨好友聊天样本（节选）：',
    block,
  ].join('\n')
}

/**
 * 容错解析情绪 JSON：剥围栏、定位首个 JSON、取 tone/summary；无法解析返回 {}，永不抛异常。
 */
export function parseSentiment(text: string): Sentiment {
  if (typeof text !== 'string') return {}
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return {}
  let obj: unknown
  try {
    obj = JSON.parse(text.slice(start, end + 1))
  } catch {
    return {}
  }
  if (typeof obj !== 'object' || obj === null) return {}
  const r = obj as Record<string, unknown>
  const out: Sentiment = {}
  if (typeof r.tone === 'string' && r.tone.trim() !== '') out.tone = r.tone.trim()
  if (typeof r.summary === 'string' && r.summary.trim() !== '') out.summary = r.summary.trim()
  return out
}

export interface MoodTimelinePoint { m: number; score: number | null }
export interface DeepSentiment {
  tone?: string
  summary?: string
  timeline?: MoodTimelinePoint[]
  me?: Sentiment
  them?: Sentiment
}

/**
 * 深度情绪提示词：在整体基调之外，额外要求逐月情绪走势(timeline)与「我/对方」各自情绪。
 * 逐月消息数写入 prompt，提示 AI 对无往来月给 null，不要编造。
 */
export function buildFriendDeepSentimentPrompt(friend: Friend, samples: string[]): string {
  const displayName = friend.alias || friend.name
  const sampleBlock = samples.length
    ? samples.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '（本次无可用聊天样本）'
  const monthly = (friend.monthly ?? []).map((c, i) => `${i + 1}月:${c}`).join(' ')

  return [
    '你是一位擅长体察人际情绪的观察者。请根据下面这位微信好友的往来统计与部分聊天样本，',
    '判断你们这一年相处的「情绪基调」，并给出逐月情绪走势，以及双方各自的情绪。',
    '',
    '只输出一个严格的 JSON 对象，不要任何解释、不要代码围栏外的文字。格式：',
    '{',
    '  "tone": "<一个具体、生动的情绪基调短词，如 热络/暧昧/渐远/客套/无话不谈>",',
    '  "summary": "<一句话说明依据，20~40 字>",',
    '  "timeline": [<覆盖 1~12 月，每项形如>{"m": <月份1-12>, "score": <该月情绪分值，-100 最消极 ~ 100 最积极；该月无往来则为 null>}],',
    '  "me": {"tone": "<我方情绪基调短词>", "summary": "<一句话，20~40 字>"},',
    '  "them": {"tone": "<对方情绪基调短词>", "summary": "<一句话，20~40 字>"}',
    '}',
    '',
    '聚合统计：',
    `- 好友：${displayName}`,
    `- 关系标签：${friend.rel}`,
    `- 职务/备注：${friend.role || '（未填）'}`,
    `- 全年消息往来：${friend.msgCount} 条`,
    `- 我方发送占比：${friend.sentRatio}%`,
    `- 活跃时段：${friend.peakPeriod || '（无）'}`,
    `- 逐月消息数：${monthly}`,
    '',
    '（timeline 必须逐月给出：某月逐月消息数为 0 时该月 score 用 null，不要编造情绪。）',
    '',
    '部分聊天样本（「我」为用户本人，「对方」为该好友）：',
    sampleBlock,
  ].join('\n')
}
