import type { Conversation, Friend } from '../model/types'
import { createFriend } from '../model/friend'

export function aggregate(conversations: Conversation[]): Friend[] {
  return conversations.map((c) => {
    const f = createFriend(c.id, c.peerName)
    const msgs = c.messages
    f.msgCount = msgs.length
    if (msgs.length === 0) return f

    let sent = 0
    let first = Infinity
    let last = -Infinity
    for (const m of msgs) {
      if (m.from === 'me') sent++
      if (m.ts && m.ts < first) first = m.ts
      if (m.ts && m.ts > last) last = m.ts
      if (m.ts) f.monthly[new Date(m.ts).getMonth()]++
    }
    f.sentRatio = Math.round((sent / msgs.length) * 100)
    f.firstContact = first === Infinity ? 0 : first
    f.lastContact = last === -Infinity ? 0 : last
    return f
  })
}
