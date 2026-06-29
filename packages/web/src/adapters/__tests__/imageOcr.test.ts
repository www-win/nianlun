import { describe, it, expect, vi } from 'vitest'
import { isImageFile, ocrImage } from '../imageOcr'

const settings = { baseUrl: '/__ai', apiKey: 'k', model: 'claude-opus-4-8' }

describe('isImageFile', () => {
  it('recognizes image extensions case-insensitively', () => {
    expect(isImageFile(new File([''], 'a.PNG'))).toBe(true)
    expect(isImageFile(new File([''], 'b.jpg'))).toBe(true)
    expect(isImageFile(new File([''], 'c.jpeg'))).toBe(true)
    expect(isImageFile(new File([''], 'd.webp'))).toBe(true)
    expect(isImageFile(new File([''], 'e.txt'))).toBe(false)
  })
})

describe('ocrImage', () => {
  it('returns a ReadFile whose content is the model text, year woven into prompt', async () => {
    const captured: any[] = []
    const fetchImpl = vi.fn(async (url: string, init: any) => {
      captured.push(JSON.parse(init.body))
      return {
        ok: true, status: 200,
        json: async () => ({ content: [{ type: 'text', text: '2024-05-01 09:00:00 我\n在吗' }] }),
      }
    })
    const file = new File([new Uint8Array([1, 2, 3])], 'chat.png', { type: 'image/png' })
    const out = await ocrImage(file, 2024, settings, fetchImpl as any)
    expect(out.name).toBe('chat.png')
    expect(out.content).toBe('2024-05-01 09:00:00 我\n在吗')
    const sent = captured[0].messages[0].content
    expect(sent[0].source.media_type).toBe('image/png')
    expect(typeof sent[0].source.data).toBe('string')
    expect(sent[1].text).toContain('2024') // year woven in
  })

  it('strips Markdown code fences the model may wrap output in', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ content: [{ type: 'text', text: '```\n2024-05-01 09:00:00 我\n在吗\n```' }] }),
    }))
    const file = new File([new Uint8Array([1])], 'c.png', { type: 'image/png' })
    const out = await ocrImage(file, 2024, settings, fetchImpl as any)
    expect(out.content).toBe('2024-05-01 09:00:00 我\n在吗')
  })
})
