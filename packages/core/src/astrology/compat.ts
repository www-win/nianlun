import { STEM_WUXING } from './chart'
import { wuxingRelation } from './fortune'
import type { BaziChart, Compatibility } from './types'

// 地支六冲
const CLASH: Array<[string, string]> = [
  ['子', '午'], ['丑', '未'], ['寅', '申'], ['卯', '酉'], ['辰', '戌'], ['巳', '亥'],
]
// 地支六合
const SIX_HARMONY: Array<[string, string]> = [
  ['子', '丑'], ['寅', '亥'], ['卯', '戌'], ['辰', '酉'], ['巳', '申'], ['午', '未'],
]

function inPairs(pairs: Array<[string, string]>, a: string, b: string): boolean {
  return pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
}
export function isBranchClash(a: string, b: string): boolean { return inPairs(CLASH, a, b) }
export function isBranchHarmony(a: string, b: string): boolean { return inPairs(SIX_HARMONY, a, b) }

/** 年柱地支（即生肖对应的支）。 */
function yearBranch(chart: BaziChart): string { return chart.pillars.year.charAt(1) }

/**
 * 合盘（a=我，b=好友）：以年支（生肖）判六合/相冲，附日主五行生克描述。
 * 纯机械判定，不涉 AI。
 */
export function getCompatibility(a: BaziChart, b: BaziChart): Compatibility {
  const harmonies: string[] = []
  const clashes: string[] = []
  const ba = yearBranch(a)
  const bb = yearBranch(b)

  if (isBranchClash(ba, bb)) clashes.push(`生肖相冲（${a.zodiac} ↔ ${b.zodiac}）`)
  if (isBranchHarmony(ba, bb)) harmonies.push(`生肖六合（${a.zodiac} ↔ ${b.zodiac}）`)

  // 日主五行生克：对方日主相对我的关系
  const rel = wuxingRelation(STEM_WUXING[a.dayMaster], STEM_WUXING[b.dayMaster])
  if (rel === '生') harmonies.push('对方日主生我，相处得助')
  else if (rel === '克') clashes.push('对方日主克我，易受牵制')

  return { harmonies, clashes }
}

/**
 * 今日流日支 是否冲某盘的本命年支/日支。返回相冲描述数组（空=不冲）。
 * dayBranch 为当日干支的地支（流日支）。
 */
export function dayBranchClashes(dayBranch: string, chart: BaziChart): string[] {
  const out: string[] = []
  if (isBranchClash(dayBranch, chart.pillars.year.charAt(1))) out.push('流日冲本命年支')
  if (isBranchClash(dayBranch, chart.pillars.day.charAt(1))) out.push('流日冲本命日支')
  return out
}
