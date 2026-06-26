import type { Friend, ReportData } from '../model/types'

export function buildReportCopyPrompt(report: ReportData, friends: Friend[]): string {
  const nameById = new Map(friends.map((f) => [f.id, f.alias || f.name]))
  const top = report.topContacts
    .map((c, i) => `${i + 1}. ${nameById.get(c.friendId) ?? c.friendId}（${c.msgCount} 条）`)
    .join('；')
  const rel = report.relationBreakdown
    .map((r) => `${r.rel} ${r.percent}%`)
    .join('，')

  return [
    '你是一位温暖细腻的文案写手。请根据下面这位用户的微信社交统计数据，',
    '写一段 100~200 字、有温度、口语化的中文年度总结文案，适合放进年度报告海报。',
    '不要罗列数字清单，把数字自然融进叙述里。只输出文案本身，不要标题、不要解释。',
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
