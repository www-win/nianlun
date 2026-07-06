import { describe, it, expect } from 'vitest'
import { birthFingerprint, assembleAstro, astroExpired } from '../astroView'
import type { BirthInfo } from '@nianlun/core'

const BIRTH: BirthInfo = { year: 1990, month: 8, day: 15, hour: 14 }

describe('birthFingerprint', () => {
  it('相同生辰指纹一致，不同则不同，空为空串', () => {
    expect(birthFingerprint(BIRTH)).toBe(birthFingerprint({ ...BIRTH }))
    expect(birthFingerprint(BIRTH)).not.toBe(birthFingerprint({ ...BIRTH, day: 16 }))
    expect(birthFingerprint(null)).toBe('')
  })
})

describe('assembleAstro', () => {
  it('装配好友盘+流日；有我方生辰则出 myChart 与 compat', () => {
    const a = assembleAstro(BIRTH, { year: 1984, month: 6, day: 1 }, { year: 2026, month: 7, day: 6 })
    expect(a.friendChart.zodiac).toContain('马')
    expect(a.fortune.ganzhi).toHaveLength(2)
    expect(a.myChart).not.toBeNull()
    expect(a.compat).not.toBeNull()
  })
  it('无我方生辰则 myChart/compat 为 null', () => {
    const a = assembleAstro(BIRTH, null, { year: 2026, month: 7, day: 6 })
    expect(a.myChart).toBeNull()
    expect(a.compat).toBeNull()
  })
})

describe('astroExpired', () => {
  it('同日期同指纹=未过期', () => {
    expect(astroExpired('2026-07-06', 'a', 'b', '2026-07-06', 'a', 'b')).toBe(false)
  })
  it('跨天=过期', () => {
    expect(astroExpired('2026-07-05', 'a', 'b', '2026-07-06', 'a', 'b')).toBe(true)
  })
  it('生辰或我的盘指纹变=过期', () => {
    expect(astroExpired('2026-07-06', 'a', 'b', '2026-07-06', 'z', 'b')).toBe(true)
    expect(astroExpired('2026-07-06', 'a', 'b', '2026-07-06', 'a', 'z')).toBe(true)
  })
})
