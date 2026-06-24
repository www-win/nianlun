import { describe, it, expect } from 'vitest'
import { txtParser } from '../txt'

const SAMPLE = `2025-03-14 02:47:11 周彤
没赶上末班车那年的事

2025-03-14 02:48:02 我
那就打车回去吧
路上小心`

describe('txtParser', () => {
  it('canParse recognizes timestamped lines', () => {
    expect(txtParser.canParse('chat.txt', SAMPLE)).toBe(true)
    expect(txtParser.canParse('data.json', '{"a":1}')).toBe(false)
  })

  it('parses messages into one conversation', () => {
    const { conversations, warnings } = txtParser.parse(SAMPLE)
    expect(warnings).toHaveLength(0)
    expect(conversations).toHaveLength(1)
    const c = conversations[0]
    expect(c.peerName).toBe('周彤')
    expect(c.messages).toHaveLength(2)
    expect(c.messages[0].from).toBe('them')
    expect(c.messages[0].text).toBe('没赶上末班车那年的事')
    expect(c.messages[1].from).toBe('me')
    expect(c.messages[1].text).toBe('那就打车回去吧\n路上小心')
    expect(c.messages[1].ts).toBe(new Date('2025-03-14T02:48:02').getTime())
  })

  it('records a warning for an unparseable header but keeps good messages', () => {
    const bad = `garbage line without timestamp
2025-03-14 02:47:11 周彤
你好`
    const { conversations, warnings } = txtParser.parse(bad)
    expect(conversations[0].messages).toHaveLength(1)
    expect(warnings.length).toBeGreaterThan(0)
  })
})
