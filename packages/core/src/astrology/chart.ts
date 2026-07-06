import { Solar } from 'lunar-javascript'
import type { BirthInfo, BaziChart } from './types'

/** 天干五行。 */
export const STEM_WUXING: Record<string, string> = {
  甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土',
  己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水',
}
/** 地支本气五行。 */
export const BRANCH_WUXING: Record<string, string> = {
  子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火',
  午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水',
}

/**
 * 由生辰确定性排八字盘。含时辰则出四柱，缺则只出三柱。
 * 纯函数：不 new Date()、不访问全局，仅依赖 lunar-javascript 计算。
 */
export function buildBaziChart(birth: BirthInfo): BaziChart {
  const { year, month, day, hour } = birth
  const solar = hour != null
    ? Solar.fromYmdHms(year, month, day, hour, 0, 0)
    : Solar.fromYmd(year, month, day)
  const lunar = solar.getLunar()
  const ec = lunar.getEightChar()

  const pillars: BaziChart['pillars'] = {
    year: ec.getYear(),
    month: ec.getMonth(),
    day: ec.getDay(),
  }
  if (hour != null) pillars.hour = ec.getTime()

  // 五行分布：四柱天干 + 地支本气逐字计数。
  const fiveElements: Record<string, number> = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 }
  for (const p of [pillars.year, pillars.month, pillars.day, pillars.hour]) {
    if (!p) continue
    const w1 = STEM_WUXING[p.charAt(0)]
    const w2 = BRANCH_WUXING[p.charAt(1)]
    if (w1) fiveElements[w1]++
    if (w2) fiveElements[w2]++
  }

  return {
    pillars,
    dayMaster: pillars.day.charAt(0),
    fiveElements,
    zodiac: lunar.getYearShengXiao(),
    constellation: solar.getXingZuo(),
  }
}
