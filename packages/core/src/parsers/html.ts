import type { Parser, ParseResult, Conversation, Message, ParseWarning } from '../model/types'

// MSG matches the assumed export format per plan (div.msg with data-from/data-name/data-ts attrs).
// HTML exports from other tools or app versions that use a different structure need a dedicated adapter.
const MSG = /<div class="msg"([^>]*)>([\s\S]*?)<\/div>/g
const ATTR = (attrs: string, name: string) => {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs)
  return m ? m[1] : ''
}
const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').trim()

export const htmlParser: Parser = {
  name: 'html',

  canParse(fileName, sample) {
    if (fileName.toLowerCase().endsWith('.html') || fileName.toLowerCase().endsWith('.htm')) return true
    return /<!doctype html|<html/i.test(sample)
  },

  parse(content, onProgress): ParseResult {
    const messages: Message[] = []
    const warnings: ParseWarning[] = []
    let peerName = ''
    let m: RegExpExecArray | null
    MSG.lastIndex = 0
    while ((m = MSG.exec(content)) !== null) {
      const attrs = m[1]
      const from = ATTR(attrs, 'data-from') === 'me' ? 'me' : 'them'
      const name = ATTR(attrs, 'data-name')
      const tsRaw = ATTR(attrs, 'data-ts')
      const ts = tsRaw ? new Date(tsRaw).getTime() : 0
      if (Number.isNaN(ts)) { warnings.push({ reason: `无法解析时间:${tsRaw}` }); continue }
      if (from === 'them' && name && !peerName) peerName = name
      messages.push({ ts, from, type: 'text', text: stripTags(m[2]) })
    }
    if (onProgress) onProgress(1)

    const conv: Conversation = {
      id: peerName || 'unknown',
      peerName: peerName || '未知联系人',
      isGroup: false,
      messages,
    }
    return { conversations: messages.length ? [conv] : [], warnings }
  },
}
