import { describe, it, expect } from 'vitest'
import { htmlParser } from '../html'

const SAMPLE = `<!doctype html><html><body>
<div class="msg" data-from="them" data-name="周彤" data-ts="2025-03-14T02:47:11">没赶上末班车</div>
<div class="msg" data-from="me" data-ts="2025-03-14T02:48:02">那就打车吧</div>
</body></html>`

describe('htmlParser', () => {
  it('canParse recognizes html', () => {
    expect(htmlParser.canParse('export.html', SAMPLE)).toBe(true)
    expect(htmlParser.canParse('a.txt', 'plain')).toBe(false)
  })

  it('extracts messages and peer name', () => {
    const { conversations } = htmlParser.parse(SAMPLE)
    expect(conversations).toHaveLength(1)
    expect(conversations[0].peerName).toBe('周彤')
    expect(conversations[0].messages).toHaveLength(2)
    expect(conversations[0].messages[0].from).toBe('them')
    expect(conversations[0].messages[0].text).toBe('没赶上末班车')
    expect(conversations[0].messages[1].from).toBe('me')
  })
})
