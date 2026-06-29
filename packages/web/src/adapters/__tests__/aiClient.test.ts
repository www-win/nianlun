import { describe, it, expect, vi } from 'vitest'
import { generateText, extractFromImage, type AiSettings } from '../aiClient'

const settings: AiSettings = { baseUrl: 'https://api.x.com', apiKey: 'sk-1', model: 'claude-opus-4-8' }

function fakeFetch(resp: { ok: boolean; status: number; body: any }) {
  return vi.fn(async (_url: string, _init: RequestInit) => ({ ok: resp.ok, status: resp.status, json: async () => resp.body }))
}

describe('generateText', () => {
  it('成功时返回第一个 text 块', async () => {
    const f = fakeFetch({ ok: true, status: 200, body: { content: [{ type: 'text', text: '你好年度文案' }] } })
    const out = await generateText('prompt', settings, f)
    expect(out).toBe('你好年度文案')
  })

  it('请求头与请求体正确', async () => {
    const f = fakeFetch({ ok: true, status: 200, body: { content: [{ type: 'text', text: 'x' }] } })
    await generateText('我的提示词', settings, f)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://api.x.com/v1/messages')
    expect((init as any).headers['x-api-key']).toBe('sk-1')
    expect((init as any).headers['anthropic-version']).toBe('2023-06-01')
    expect((init as any).headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    const sent = JSON.parse((init as any).body)
    expect(sent.model).toBe('claude-opus-4-8')
    expect(sent.messages[0].content).toBe('我的提示词')
  })

  it('401 抛出 key 无效提示', async () => {
    const f = fakeFetch({ ok: false, status: 401, body: {} })
    await expect(generateText('p', settings, f)).rejects.toThrow(/API Key 无效/)
  })

  it('429 抛出限流提示', async () => {
    const f = fakeFetch({ ok: false, status: 429, body: {} })
    await expect(generateText('p', settings, f)).rejects.toThrow(/频繁|额度/)
  })

  it('网络异常抛出连接提示', async () => {
    const f = vi.fn(async () => { throw new Error('boom') })
    await expect(generateText('p', settings, f)).rejects.toThrow(/无法连接|跨域/)
  })

  it('空内容抛出提示', async () => {
    const f = fakeFetch({ ok: true, status: 200, body: { content: [] } })
    await expect(generateText('p', settings, f)).rejects.toThrow(/为空/)
  })
})

const settingsImg = { baseUrl: '/__ai', apiKey: 'k', model: 'claude-opus-4-8' }

function fakeFetchImg(captured: any[], resp: any) {
  return vi.fn(async (url: string, init: any) => {
    captured.push({ url, body: JSON.parse(init.body) })
    return resp
  })
}

describe('extractFromImage', () => {
  it('sends an image block + prompt and returns the text', async () => {
    const captured: any[] = []
    const fetchImpl = fakeFetchImg(captured, {
      ok: true, status: 200,
      json: async () => ({ content: [{ type: 'text', text: '2025-01-01 10:00:00 我\n你好' }] }),
    })
    const out = await extractFromImage(
      { base64: 'AAAA', mediaType: 'image/png' }, '提取对话', settingsImg, fetchImpl as any,
    )
    expect(out).toBe('2025-01-01 10:00:00 我\n你好')
    expect(captured[0].url).toBe('/__ai/v1/messages')
    const content = captured[0].body.messages[0].content
    expect(content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    })
    expect(content[1]).toEqual({ type: 'text', text: '提取对话' })
    expect(captured[0].body.max_tokens).toBeGreaterThanOrEqual(4096)
  })

  it('maps HTTP 401 to a friendly error', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }))
    await expect(
      extractFromImage({ base64: 'A', mediaType: 'image/png' }, 'p', settingsImg, fetchImpl as any),
    ).rejects.toThrow('API Key 无效，请检查设置中的密钥')
  })
})
