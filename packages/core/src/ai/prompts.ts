import type { Friend, ReportData } from '../model/types'

export function buildReportCopyPrompt(report: ReportData, friends: Friend[]): string {
  const byId = new Map(friends.map((f) => [f.id, f]))
  const top = report.topContacts
    .map((c, i) => {
      const f = byId.get(c.friendId)
      const name = f ? f.alias || f.name : c.friendId
      const rel = f ? `·${f.rel}` : ''
      const note = f && f.role ? `，备注「${f.role}」` : ''
      return `${i + 1}. ${name}${rel}（${c.msgCount} 条${note}）`
    })
    .join('；')
  const rel = report.relationBreakdown
    .map((r) => `${r.rel} ${r.percent}%`)
    .join('，')

  return [
    '你是一位温暖细腻的文案写手。请根据下面这位用户的微信社交统计数据，',
    '写一段 100~200 字、有温度、口语化的中文年度总结文案，适合放进年度报告海报。',
    '不要罗列数字清单，把数字自然融进叙述里。只输出文案本身，不要标题、不要解释。',
    '若某位联系人带有「备注」，请把它当作你对这个人的了解，自然融入对他/她的描述。',
    '',
    '统计数据：',
    `- 年份：${report.year}`,
    `- 全年消息总数：${report.totalMessages}`,
    `- 联系的好友数：${report.friendCount}`,
    `- 活跃聊天天数：${report.activeDays}`,
    `- 聊得最多的人：${top || '（无）'}`,
    `- 关系分布：${rel || '（无）'}`,
  ].join('\n')
}

const fmtDate = (ts: number) => (ts ? new Date(ts).toISOString().slice(0, 10) : '—')

export function buildFriendAnalysisPrompt(friend: Friend): string {
  const displayName = friend.alias || friend.name
  const monthly = friend.monthly.map((n, i) => `${i + 1}月 ${n}`).join('，')

  return [
    '你是一位温暖细腻、擅长观察人际关系的写手。请根据下面这位微信好友的往来统计数据，',
    '写一段 100~200 字、有温度、口语化的中文「关系画像」，适合放进个人年度回顾。',
    '描述你们的关系亲疏、互动节奏、以及值得记住的点。',
    '不要罗列数字清单，把数字自然融进叙述里。只输出画像本身，不要标题、不要解释。',
    '',
    '统计数据（均为聚合统计，不含聊天内容）：',
    `- 好友：${displayName}`,
    `- 关系标签：${friend.rel}`,
    `- 职务/备注：${friend.role || '（未填）'}`,
    `- 全年消息往来：${friend.msgCount} 条`,
    `- 我方发送占比：${friend.sentRatio}%`,
    `- 活跃时段：${friend.peakPeriod || '（无）'}`,
    `- 最长连续聊天：${friend.maxStreak} 天`,
    `- 首次联系：${fmtDate(friend.firstContact)}`,
    `- 最近联系：${fmtDate(friend.lastContact)}`,
    `- 全年月度消息分布：${monthly}`,
  ].join('\n')
}
