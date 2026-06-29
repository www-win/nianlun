import { describe, it, expect, vi } from 'vitest'
import { isImageFile, ocrImage, normalizeTimestamps } from '../imageOcr'
import { parseFile } from '@nianlun/core'

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

  it('strips fences with no trailing newline before closing ```', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ content: [{ type: 'text', text: '```\n2024-05-01 09:00:00 我\n在吗```' }] }),
    }))
    const file = new File([new Uint8Array([1])], 'c.png', { type: 'image/png' })
    const out = await ocrImage(file, 2024, settings, fetchImpl as any)
    expect(out.content).toBe('2024-05-01 09:00:00 我\n在吗')
  })
})

describe('normalizeTimestamps', () => {
  it('pads HH:MM headers to HH:MM:SS', () => {
    expect(normalizeTimestamps('2024-05-01 10:30 周彤\n在吗')).toBe('2024-05-01 10:30:00 周彤\n在吗')
  })

  it('leaves already-complete HH:MM:SS headers unchanged', () => {
    expect(normalizeTimestamps('2024-05-01 10:30:45 周彤\n在吗')).toBe('2024-05-01 10:30:45 周彤\n在吗')
  })

  it('leaves body lines unchanged', () => {
    expect(normalizeTimestamps('好的，明天见')).toBe('好的，明天见')
  })
})

describe('ocrImage → parseFile parser contract', () => {
  // Regression: model often emits timestamps without seconds (10:30 instead of 10:30:00).
  // The txt parser HEADER regex requires seconds; without normalizeTimestamps the lines fail
  // the regex → they become warnings, no friend is created → the feature silently imports nothing.
  it('seconds-less model output is normalized so parseFile yields messages and no header warnings', async () => {
    // Seconds-LESS raw model text — this is what real screenshots produce before the fix.
    const secondsLessText = '2024-05-01 10:30 周彤\n在吗\n\n2024-05-01 10:31 我\n在的'

    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ content: [{ type: 'text', text: secondsLessText }] }),
    }))
    const file = new File([new Uint8Array([1])], 'chat.png', { type: 'image/png' })
    const out = await ocrImage(file, 2024, settings, fetchImpl as any)

    // After normalizeTimestamps, content must have seconds
    expect(out.content).toContain('2024-05-01 10:30:00 周彤')
    expect(out.content).toContain('2024-05-01 10:31:00 我')

    // The parsed result must contain real messages, not just warnings
    const result = parseFile(file.name, out.content)
    expect(result.conversations.length).toBeGreaterThan(0)
    const allMessages = result.conversations.flatMap((c) => c.messages)
    expect(allMessages.length).toBeGreaterThanOrEqual(2)

    // No "无法识别" header warnings for those two header lines
    const headerWarnings = result.warnings.filter((w) =>
      w.reason.includes('无法识别') && !w.reason.includes('格式'),
    )
    expect(headerWarnings.length).toBe(0)
  })
})
