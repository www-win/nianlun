import { describe, it, expect } from 'vitest'
import { RELATIONS, REL_COLORS, relColor, initials } from '../relations'

describe('relations lib', () => {
  it('lists the six relations in order', () => {
    expect(RELATIONS).toEqual(['家人', '挚友', '同事', '同学', '客户', '其他'])
  })

  it('maps every relation to a colour', () => {
    for (const r of RELATIONS) expect(typeof REL_COLORS[r]).toBe('string')
  })

  it('relColor falls back for unknown relations', () => {
    expect(relColor('挚友')).toBe(REL_COLORS['挚友'])
    expect(relColor('不存在')).toBe('oklch(60% 0.02 240)')
  })

  it('initials takes the last two characters', () => {
    expect(initials('周彤')).toBe('周彤')
    expect(initials('陈志远')).toBe('志远')
    expect(initials('王')).toBe('王')
  })
})
