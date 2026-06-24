import type { Conversation, Message, Friend } from '../model/types'

const msgKey = (m: Message) => `${m.ts}|${m.from}|${m.text ?? ''}`

// NOTE: mergeConversations keys on peerName while mergeFriends keys on Friend.id.
// All current parsers set Conversation.id === peerName, so they agree today.
// If a future adapter makes id a stable identifier distinct from the display
// peerName, update this to merge on id to avoid splitting the same conversation.
export function mergeConversations(a: Conversation[], b: Conversation[]): Conversation[] {
  const byPeer = new Map<string, Conversation>()
  const add = (c: Conversation) => {
    const exist = byPeer.get(c.peerName)
    if (!exist) {
      byPeer.set(c.peerName, { ...c, messages: [...c.messages] })
    } else {
      exist.messages.push(...c.messages)
    }
  }
  ;[...a, ...b].forEach(add)

  return [...byPeer.values()].map((c) => {
    const seen = new Set<string>()
    const messages = c.messages
      .filter((m) => { const k = msgKey(m); if (seen.has(k)) return false; seen.add(k); return true })
      .sort((x, y) => x.ts - y.ts)
    return { ...c, messages }
  })
}

export function mergeFriends(
  existing: Friend[],
  incoming: Friend[],
): { friends: Friend[]; added: number; updated: number } {
  const byId = new Map<string, Friend>()
  existing.forEach((f) => byId.set(f.id, f))
  let added = 0
  let updated = 0

  incoming.forEach((inc) => {
    const old = byId.get(inc.id)
    if (!old) { byId.set(inc.id, inc); added++; return }
    updated++
    const merged: Friend = { ...inc } // 统计字段取新值
    // 用户编辑优先保留
    merged.role = old.userEdited.role ?? inc.role
    merged.rel = old.userEdited.rel ?? inc.rel
    merged.alias = old.userEdited.alias ?? inc.alias
    merged.userEdited = { ...inc.userEdited, ...old.userEdited }
    byId.set(inc.id, merged)
  })

  return { friends: [...byId.values()], added, updated }
}
