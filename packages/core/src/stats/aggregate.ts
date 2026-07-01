import type { Conversation, Friend } from '../model/types'
import { createFriend } from '../model/friend'
import { countWords } from './segment'

/** 按峰值小时映射中文时段标签；全 0（无消息）返回空串。 */
function peakPeriodLabel(hourly: number[]): string {
  let peak = -1
  let peakHour = 0
  for (let h = 0; h < hourly.length; h++) {
    if (hourly[h] > peak) { peak = hourly[h]; peakHour = h }
  }
  if (peak <= 0) return ''
  if (peakHour < 6) return '凌晨'
  if (peakHour < 12) return '上午'
  if (peakHour < 14) return '中午'
  if (peakHour < 19) return '下午'
  return '晚上'
}

/** 一组日历日序号里最长的连续段长度（天）。空集返回 0。 */
function longestStreak(days: Set<number>): number {
  if (days.size === 0) return 0
  const sorted = [...days].sort((a, b) => a - b)
  let best = 1
  let run = 1
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] - sorted[i - 1] === 1 ? run + 1 : 1
    if (run > best) best = run
  }
  return best
}

export function aggregate(conversations: Conversation[]): Friend[] {
  return conversations.map((c) => {
    const f = createFriend(c.id, c.peerName)
    const msgs = c.messages
    f.msgCount = msgs.length
    if (msgs.length === 0) return f

    let sent = 0
    let first = Infinity
    let last = -Infinity
    const texts: string[] = []
    const days = new Set<number>() // 有消息的日期(本地日历日序号)，用于最长连续天数
    for (const m of msgs) {
      if (m.from === 'me') sent++
      if (m.ts && m.ts < first) first = m.ts
      if (m.ts && m.ts > last) last = m.ts
      if (m.ts) {
        const d = new Date(m.ts)
        f.monthly[d.getMonth()]++
        f.hourly[d.getHours()]++
        f.weekHour[d.getDay() * 24 + d.getHours()]++
        days.add(Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000))
      }
      if (m.type === 'text' && m.text) texts.push(m.text)
    }
    f.keywords = countWords(texts, 20)
    f.sentRatio = Math.round((sent / msgs.length) * 100)
    f.firstContact = first === Infinity ? 0 : first
    f.lastContact = last === -Infinity ? 0 : last
    f.maxStreak = longestStreak(days)
    f.peakPeriod = peakPeriodLabel(f.hourly)
    return f
  })
}
