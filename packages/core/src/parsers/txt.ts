import type { Parser, ParseResult, Conversation, Message, ParseWarning } from '../model/types'

const HEADER = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (.+)$/

export const txtParser: Parser = {
  name: 'txt',

  canParse(fileName, sample) {
    if (fileName.toLowerCase().endsWith('.txt')) return true
    return sample.split(/\r?\n/).some((l) => HEADER.test(l))
  },

  parse(content, onProgress): ParseResult {
    const lines = content.split(/\r?\n/)
    const messages: Message[] = []
    const warnings: ParseWarning[] = []
    let peerName = ''
    let cur: { ts: number; from: 'me' | 'them'; body: string[] } | null = null

    const flush = () => {
      if (cur) {
        messages.push({ ts: cur.ts, from: cur.from, type: 'text', text: cur.body.join('\n').trim() })
        cur = null
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const m = HEADER.exec(line)
      if (m) {
        flush()
        const sender = m[2].trim()
        const from = sender === '我' ? 'me' : 'them'
        if (from === 'them' && !peerName) peerName = sender
        cur = { ts: new Date(m[1].replace(' ', 'T')).getTime(), from, body: [] }
      } else if (cur) {
        if (line.trim() !== '') cur.body.push(line)
      } else if (line.trim() !== '') {
        warnings.push({ line: i + 1, reason: '无法识别的行,已跳过' })
      }
      if (onProgress && lines.length) onProgress((i + 1) / lines.length)
    }
    flush()

    const conv: Conversation = {
      id: peerName || 'unknown',
      peerName: peerName || '未知联系人',
      isGroup: false,
      messages,
    }
    return { conversations: messages.length ? [conv] : [], warnings }
  },
}
