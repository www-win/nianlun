import type { Conversation, Friend } from '../model/types'
import { createFriend } from '../model/friend'
import { countWords } from './segment'

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
    for (const m of msgs) {
      if (m.from === 'me') sent++
      if (m.ts && m.ts < first) first = m.ts
      if (m.ts && m.ts > last) last = m.ts
      if (m.ts) {
        const d = new Date(m.ts)
        f.monthly[d.getMonth()]++
        f.hourly[d.getHours()]++
        f.weekHour[d.getDay() * 24 + d.getHours()]++
      }
      if (m.type === 'text' && m.text) texts.push(m.text)
    }
    f.keywords = countWords(texts, 20)
    f.sentRatio = Math.round((sent / msgs.length) * 100)
    f.firstContact = first === Infinity ? 0 : first
    f.lastContact = last === -Infinity ? 0 : last
    return f
  })
}
