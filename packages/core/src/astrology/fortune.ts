import { Solar } from 'lunar-javascript'
import { STEM_WUXING } from './chart'
import type { BaziChart, DayFortune } from './types'

// 五行相生：木→火→土→金→水→木
const SHENG: Record<string, string> = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' }
// 五行相克：木→土→水→火→金→木
const KE: Record<string, string> = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' }

/**
 * other 相对 base（我）的关系：
 * 比(同) / 生(other 生我) / 泄(我生 other) / 克(other 克我) / 耗(我克 other) / 平(未知)
 */
export function wuxingRelation(base: string, other: string): string {
  if (!base || !other) return '平'
  if (base === other) return '比'
  if (SHENG[other] === base) return '生'
  if (SHENG[base] === other) return '泄'
  if (KE[other] === base) return '克'
  if (KE[base] === other) return '耗'
  return '平'
}

/**
 * 某公历日期的当日干支，及其天干五行对本命日主的生克。
 * date 由调用方传入（core 不取系统时间，保证确定可测）。
 */
export function getDayFortune(
  date: { year: number; month: number; day: number },
  chart: BaziChart,
): DayFortune {
  const lunar = Solar.fromYmd(date.year, date.month, date.day).getLunar()
  const ganzhi = lunar.getDayInGanZhi()
  const dayGanWuxing = STEM_WUXING[ganzhi.charAt(0)]
  const baseWuxing = STEM_WUXING[chart.dayMaster]
  return { ganzhi, relation: wuxingRelation(baseWuxing, dayGanWuxing) }
}
