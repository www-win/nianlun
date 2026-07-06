import { buildBaziChart, getDayFortune, getCompatibility } from '@nianlun/core'
import type { BirthInfo, BaziChart, DayFortune, Compatibility } from '@nianlun/core'

export interface AstroAssembly {
  friendChart: BaziChart
  myChart: BaziChart | null
  fortune: DayFortune
  compat: Compatibility | null
}

/** 生辰指纹：字段变化即变化；空生辰为空串。 */
export function birthFingerprint(b: BirthInfo | null | undefined): string {
  if (!b) return ''
  return JSON.stringify([b.year, b.month, b.day, b.hour ?? null, b.isLunar ?? false, b.gender ?? ''])
}

/** 装配好友盘 + 流日；有我方生辰则一并出我方盘与合盘。today 由页面传入（不在此取系统时间）。 */
export function assembleAstro(
  friendBirth: BirthInfo,
  myBirth: BirthInfo | null,
  today: { year: number; month: number; day: number },
): AstroAssembly {
  const friendChart = buildBaziChart(friendBirth)
  const myChart = myBirth ? buildBaziChart(myBirth) : null
  const fortune = getDayFortune(today, friendChart)
  const compat = myChart ? getCompatibility(myChart, friendChart) : null
  return { friendChart, myChart, fortune, compat }
}

/** 缓存是否过期：跨天或任一指纹变更即过期。 */
export function astroExpired(
  storedDate: string, storedFp: string, storedMyFp: string,
  todayStr: string, curFp: string, curMyFp: string,
): boolean {
  return storedDate !== todayStr || storedFp !== curFp || storedMyFp !== curMyFp
}
