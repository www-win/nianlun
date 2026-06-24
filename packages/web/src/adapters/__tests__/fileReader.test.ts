import { describe, it, expect } from 'vitest'
import { readTextFile } from '../fileReader'

describe('readTextFile', () => {
  it('reads a File into { name, content }', async () => {
    const file = new File(['2025-01-01 10:00:00 周彤\n你好'], 'chat.txt', { type: 'text/plain' })
    const result = await readTextFile(file)
    expect(result.name).toBe('chat.txt')
    expect(result.content).toContain('周彤')
  })
})
