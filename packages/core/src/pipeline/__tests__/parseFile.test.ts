import { describe, it, expect } from 'vitest'
import { parseFile } from '../parseFile'

describe('parseFile', () => {
  it('routes txt content to txt parser', () => {
    const r = parseFile('chat.txt', '2025-03-14 02:47:11 周彤\n你好')
    expect(r.conversations).toHaveLength(1)
    expect(r.conversations[0].peerName).toBe('周彤')
  })

  it('returns a warning when no parser matches', () => {
    const r = parseFile('mystery.bin', '  binary garbage')
    expect(r.conversations).toHaveLength(0)
    expect(r.warnings.length).toBeGreaterThan(0)
  })
})
